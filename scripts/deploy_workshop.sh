#!/usr/bin/env bash

set -euo pipefail

load_env_file() {
    if [ -f ".env" ]; then
        if [ -z "${ZED_CACHE_DIR:-}" ]; then
            ZED_CACHE_DIR=$(grep '^ZED_CACHE_DIR=' ".env" | head -n 1 | cut -d '=' -f 2- | tr -d '\r')
            export ZED_CACHE_DIR
        fi
    fi
}

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <WorkshopItemName>"
    echo "Example: $0 MyExampleWorkshop"
    exit 1
fi

WORKSHOP_NAME=$1
SOURCE_DIR="$WORKSHOP_NAME"

if [ ! -d "$SOURCE_DIR" ]; then
    echo "Error: Workshop item '$SOURCE_DIR' does not exist."
    exit 1
fi

if [ ! -f "$SOURCE_DIR/workshop.txt" ]; then
    echo "Error: '$SOURCE_DIR' is missing workshop.txt."
    exit 1
fi

if [ ! -d "$SOURCE_DIR/Contents/mods" ]; then
    echo "Error: '$SOURCE_DIR' is missing Contents/mods."
    exit 1
fi

load_env_file

WORKSHOP_TITLE=$(grep '^title=' "$SOURCE_DIR/workshop.txt" | head -n 1 | cut -d '=' -f 2- | tr -d '\r')

if [ -z "$WORKSHOP_TITLE" ]; then
    WORKSHOP_TITLE=$WORKSHOP_NAME
fi

case "$WORKSHOP_TITLE" in
    *"/"*)
        echo "Error: workshop.txt title must not contain '/'."
        exit 1
        ;;
esac

if [ -n "${ZED_CACHE_DIR:-}" ]; then
    CACHE_ROOT=$ZED_CACHE_DIR
else
    CACHE_ROOT="$HOME/Zomboid"
fi

DEST_DIR="$CACHE_ROOT/Workshop/$WORKSHOP_TITLE"

mkdir -p "$CACHE_ROOT/Workshop"
rm -rf "$DEST_DIR"

echo "Deploying workshop item '$WORKSHOP_NAME' to '$DEST_DIR'..."
cp -R "$SOURCE_DIR" "$DEST_DIR"
rm -rf "$DEST_DIR/.git"

echo "Success: deployed '$WORKSHOP_NAME' to '$DEST_DIR'."