package routes

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path"

	"github.com/labstack/echo/v4"
	"github.com/sheodox/overseer-echo/config"
	"github.com/sheodox/overseer-echo/management"
)

func Upload(c echo.Context) error {
	id := c.Param("id")
	if id == "" {
		return c.String(http.StatusBadRequest, "Missing upload ID")
	}

	expected := management.ConsumeExpectedUpload(id)

	if !expected {
		return c.String(http.StatusUnauthorized, fmt.Sprintf("Upload with ID %q isn't expected!", id))
	}

	file, err := c.FormFile("echo-item")
	if err != nil {
		c.Logger().Error("Error retrieving file from form", err)
		return c.String(http.StatusBadRequest, "Bad request")
	}

	src, err := file.Open()
	if err != nil {
		c.Logger().Error("Error opening file from form", err)
		return c.String(http.StatusBadRequest, "Bad request")
	}
	defer src.Close()

	dst, err := os.Create(path.Join(config.GetConfig().StoragePath, id+".zip"))
	if err != nil {
		c.Logger().Error("Error creating destination file", err)
		return c.String(http.StatusBadRequest, "Bad request")
	}
	defer dst.Close()

	if _, err = io.Copy(dst, src); err != nil {
		c.Logger().Error("Error saving upload", err)
		return c.String(http.StatusInternalServerError, "Error saving upload")
	}

	management.Uploaded(id)

	return c.String(http.StatusOK, "")
}

func Download(c echo.Context) error {
	token := c.QueryParam("token")
	if token == "" {
		return c.String(http.StatusUnauthorized, "Missing download token!")
	}

	id := c.Param("id")
	if id == "" {
		return c.String(http.StatusBadRequest, "Missing item ID")
	}

	if !management.ItemExists(id) {
		return c.String(http.StatusNotFound, fmt.Sprintf("No item with ID %q exists.", id))
	}

	allowed, itemName := management.VerifyDownloadToken(id, token)

	filePath := path.Join(config.GetConfig().StoragePath, id+".zip")

	if allowed {
		management.Downloaded(id)
		return c.Attachment(filePath, itemName+".zip")
	} else {
		return c.String(http.StatusUnauthorized, "You aren't allowed to download that.")
	}
}
