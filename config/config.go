package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type AppConfig struct {
	AppEnv        string
	StoragePath   string
	OverseerHost  string
	OverseerToken string
}

func getEnv(name string) string {
	value := os.Getenv(name)

	if value == "" {
		log.Fatalf("Missing %q in .env!\n", name)
	}

	return value
}

var cfg AppConfig
var cfgGenerated bool = false

func GetConfig() AppConfig {
	// memoize the config
	if cfgGenerated {
		return cfg
	}

	err := godotenv.Load()
	if err != nil {
		log.Fatal("Error loading .env file", err)
	}

	cfg = AppConfig{
		AppEnv:        getEnv("APP_ENV"),
		StoragePath:   getEnv("STORAGE_PATH"),
		OverseerHost:  getEnv("OVERSEER_HOST"),
		OverseerToken: getEnv("OVERSEER_TOKEN"),
	}
	cfgGenerated = true

	return cfg
}
