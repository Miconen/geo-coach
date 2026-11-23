# Companion + Transcriber on this machine, via Docker or Podman compose.
# Override with: make up CONTAINER_CLI=podman
CONTAINER_CLI ?= $(shell command -v docker >/dev/null 2>&1 && echo docker || echo podman)
COMPOSE := $(CONTAINER_CLI) compose

.PHONY: up down restart update transcriber logs status

## Start the Companion and the Transcriber in the background
up:
	$(COMPOSE) up -d

## Stop both
down:
	$(COMPOSE) down

## Restart both
restart:
	$(COMPOSE) restart

## Pull the latest images and recreate the containers
update:
	$(COMPOSE) pull
	$(COMPOSE) up -d --force-recreate

## Start only the Transcriber
transcriber:
	$(COMPOSE) up -d transcriber

## Follow logs (both services; narrow with: make logs SERVICE=transcriber)
logs:
	$(COMPOSE) logs -f $(SERVICE)

## Show container status
status:
	$(COMPOSE) ps
