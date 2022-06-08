package management

import (
	"crypto/tls"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/xid"
	"github.com/sheodox/overseer-echo/config"
)

var (
	Overseer overseerConnection = newOverseerConnection()
)

func init() {
	go createNewConnection()
}

func createNewConnection() {
	Overseer = newOverseerConnection()
	Overseer.connectSocket()
}

type overseerWSMessage struct {
	Route string    `json:"route"`
	MsgId string    `json:"msgId"`
	Data  wsPayload `json:"data"`
}

type wsPayload map[string]any

type overseerConnection struct {
	toSend   chan overseerWSMessage
	mu       sync.Mutex
	awaiting map[string]chan wsPayload
}

func newOverseerConnection() overseerConnection {
	return overseerConnection{
		toSend:   make(chan overseerWSMessage),
		mu:       sync.Mutex{},
		awaiting: make(map[string]chan wsPayload),
	}
}

func (o *overseerConnection) Send(msg overseerWSMessage) {
	o.toSend <- msg
}

func (o *overseerConnection) Request(msg overseerWSMessage) wsPayload {
	if msg.MsgId == "" {
		msg.MsgId = xid.New().String()
	}

	o.mu.Lock()
	responseChannel := make(chan wsPayload)
	o.awaiting[msg.MsgId] = responseChannel
	o.mu.Unlock()

	defer func() {
		close(responseChannel)
		o.mu.Lock()
		o.awaiting[msg.MsgId] = nil
		o.mu.Unlock()
	}()

	o.Send(msg)
	return <-responseChannel
}

func (o *overseerConnection) handleMessageFromOverseer(msg overseerWSMessage) {
	o.mu.Lock()
	// if this is the response to something we're waiting for, send that
	awaitingChannel, ok := o.awaiting[msg.MsgId]
	o.mu.Unlock()
	if msg.MsgId != "" && ok {
		awaitingChannel <- msg.Data
		return
	}

	switch msg.Route {
	case "delete":
		id, ok := msg.Data["id"]
		if !ok {
			log.Println("Overseer tried deleting an item but didn't provide an ID")
			return
		}

		idAsString, ok := id.(string)

		if !ok {
			log.Printf("Overseer tried deleting an item with ID of type %T but expected a string\n", id)
			return
		}

		DeleteItem(idAsString)
		Overseer.Send(overseerWSMessage{"deleted", msg.MsgId, wsPayload{"id": id}})
	case "expect-upload":
		id, ok := msg.Data["id"]
		if !ok {
			log.Println("Overseer notified of an expected upload but didn't provide an ID")
			return
		}

		idAsString, ok := id.(string)

		if !ok {
			log.Printf("Overseer notified of an expected upload with an ID of type %T but expected a string\n", id)
			return
		}

		ExpectUpload(idAsString)
		o.Send(overseerWSMessage{"expect-upload", msg.MsgId, wsPayload{}})
	case "verify-download-token":
		//todo
	default:
		log.Fatalf("No handler for route %q with data %v\n", msg.Route, msg.Data)
	}
}

func reconnect() {
	// attempt to reconnect
	<-time.After(time.Second * 5)
	createNewConnection()
}

func onSocketOpen() {
	sendDiskUsage()
}

func (o *overseerConnection) connectSocket() {
	cfg := config.GetConfig()

	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, os.Interrupt)

	u := url.URL{Scheme: "wss", Host: cfg.OverseerHost + ":4001", Path: "/echo-server-ws"}
	log.Printf("Connecting to %s", u.String())

	dialer := *websocket.DefaultDialer
	dialer.TLSClientConfig = &tls.Config{InsecureSkipVerify: cfg.AppEnv == "development"}
	c, _, err := dialer.Dial(u.String(), http.Header{
		"Authorization": []string{"Bearer " + cfg.OverseerToken},
		"User-Agent":    []string{"Overseer Echo"},
	})
	if err != nil {
		log.Println("dial:", err)
		reconnect()
	}
	defer c.Close()

	log.Println("Connected to Overseer")

	done := make(chan struct{})

	go func() {
		defer close(done)
		for {
			_, message, err := c.ReadMessage()
			if err != nil {
				log.Println("read:", err)

				reconnect()
				return
			}
			log.Printf("recv: %s", message)

			var msg overseerWSMessage
			err = json.Unmarshal(message, &msg)
			if err != nil {
				log.Fatal("Error unmarshalling websocket message", err)
			}

			go o.handleMessageFromOverseer(msg)
		}
	}()

	ticker := time.NewTicker(time.Second * 15)
	defer ticker.Stop()

	go onSocketOpen()

	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			// ping every so often or nginx will close the connection
			c.WriteControl(websocket.PingMessage, []byte(""), time.Now().Add(time.Second*5))
		case msg := <-o.toSend:
			log.Println("sending", msg)
			err := c.WriteJSON(msg)
			if err != nil {
				log.Println("write:", err)
				return
			}
		case <-interrupt:
			log.Println("interrupt")

			// Cleanly close the connection by sending a close message and then
			// waiting (with timeout) for the server to close the connection.
			err := c.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
			if err != nil {
				log.Println("write close:", err)
				return
			}
			select {
			case <-done:
			case <-time.After(time.Second):
			}
			return
		}
	}
}
