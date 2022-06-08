package management

import (
	"fmt"
	"log"
	"os"
	"path"
	"strings"

	mapset "github.com/deckarep/golang-set/v2"
	"github.com/google/uuid"
	"github.com/sheodox/overseer-echo/config"
	"golang.org/x/sys/unix"
)

var (
	expectedUploadIds = mapset.NewSet[string]()
	storedFileIds     = mapset.NewSet[string]()
)

func init() {
	scanFiles()
}

func ItemExists(id string) bool {
	return storedFileIds.Contains(id)
}

func isValidUuid(maybeUuid string) bool {
	_, err := uuid.Parse(maybeUuid)

	return err == nil
}

func Downloaded(id string) {
	Overseer.Send(overseerWSMessage{"downloaded", "", map[string]any{"id": id}})
}

func ExpectUpload(id string) {
	valid := isValidUuid(id)

	if valid {
		expectedUploadIds.Add(id)
	} else {
		fmt.Fprintf(os.Stderr, "Told to expect an upload for an invalid UUID %q", id)
	}
}

func ConsumeExpectedUpload(id string) bool {
	expected := expectedUploadIds.Contains(id)

	if expected {
		expectedUploadIds.Remove(id)
	}

	return expected
}

func GetItemFilePath(id string) string {
	return path.Join(config.GetConfig().StoragePath, id+".zip")
}

func DeleteItem(id string) {
	if !storedFileIds.Contains(id) {
		return
	}

	storedFileIds.Remove(id)
	os.Remove(GetItemFilePath(id))

	sendDiskUsage()
}

func sendDiskUsage() {
	usage := getDiskUsage()
	Overseer.Send(overseerWSMessage{"disk-usage", "", usage})
}

func Uploaded(id string) {
	storedFileIds.Add(id)

	info, err := os.Stat(GetItemFilePath(id))
	if err != nil {
		log.Fatal(fmt.Sprintf("Couldn't stat file upload for %q!", id), err)
	}

	fileSize := info.Size()

	// todo send disk usage
	Overseer.Send(overseerWSMessage{"uploaded", "", map[string]any{
		"id":   id,
		"size": fileSize,
	}})
}

type verifyResponse struct {
	Allowed bool   `json:"allowed"`
	Name    string `json:"name"`
}

func VerifyDownloadToken(id, token string) (bool, string) {
	res := Overseer.Request(overseerWSMessage{"verify-download-token", "", map[string]any{
		"id":    id,
		"token": token,
	}})

	allowed, ok := res["allowed"].(bool)

	if !ok {
		log.Printf("Expected 'allowed' to be a boolean but got %T\n", res["allowed"])
		return false, ""
	}

	name, ok := res["name"].(string)

	if !ok {
		log.Printf("Expected 'name' to be a string but got %T\n", res["name"])
		return false, ""
	}

	return allowed, name
}

func getDiskUsage() map[string]any {
	config := config.GetConfig()
	var stat unix.Statfs_t

	unix.Statfs(config.StoragePath, &stat)

	total := int(stat.Blocks * uint64(stat.Bsize))
	free := int(stat.Bavail * uint64(stat.Bsize))

	return map[string]any{
		"total": total,
		"used":  total - free,
		"free":  free,
	}
}

func scanFiles() {
	storedFileIds.Clear()

	files, err := os.ReadDir(config.GetConfig().StoragePath)

	if err != nil {
		log.Fatal("Error scanning for files", err)
	}

	for _, file := range files {
		id := strings.Split(file.Name(), ".")[0]

		if isValidUuid(id) {
			storedFileIds.Add(id)
		}
	}
}
