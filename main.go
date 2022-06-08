package main

import (
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/sheodox/overseer-echo/config"
	"github.com/sheodox/overseer-echo/routes"
)

func main() {
	cfg := config.GetConfig()

	e := echo.New()
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: []string{"https://" + cfg.OverseerHost},
		AllowHeaders: []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept},
	}))

	e.Use(middleware.Logger())
	e.Use(middleware.Recover())

	e.POST("/upload/:id", routes.Upload)
	e.GET("/download/:id", routes.Download)

	e.Logger.Fatal(e.Start(":" + cfg.Port))

}
