# Makefile

ifneq (,$(wildcard .env))
    include .env
    export
endif

DB_URL=jdbc:postgresql://postgres:5432/$(POSTGRES_DB)
DB_USER=$(POSTGRES_USER)
DB_PASS=$(POSTGRES_PASSWORD)
FLYWAY_CMD=docker run --rm -v $(PWD)/migrations:/flyway/sql \
	-e FLYWAY_URL=$(DB_URL) \
	-e FLYWAY_USER=$(DB_USER) \
	-e FLYWAY_PASSWORD=$(DB_PASS) \
	flyway/flyway

migrate:
	$(FLYWAY_CMD) -connectRetries=10 migrate

info:
	$(FLYWAY_CMD) info

clean:
	$(FLYWAY_CMD) clean

validate:
	$(FLYWAY_CMD) validate

backup-test:
	pg_dump -h localhost -p 5432 -U admin -Fc sber > backup.dump

