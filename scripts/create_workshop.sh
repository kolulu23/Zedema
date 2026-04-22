#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <WorkshopItemName> <InitialModId>"
    echo "Example: $0 MyExampleWorkshop MyExampleMod"
    exit 1
fi

WORKSHOP_NAME=$1
INITIAL_MOD_ID=$2
TEMPLATE_DIR="pzmc-template"
TARGET_DIR="$WORKSHOP_NAME"
PLACEHOLDER_MOD_DIR="$TARGET_DIR/Contents/mods/YOUR_MOD_HERE"
TARGET_MOD_DIR="$TARGET_DIR/Contents/mods/$INITIAL_MOD_ID"

if [ ! -d "$TEMPLATE_DIR" ]; then
    echo "Error: Template directory '$TEMPLATE_DIR' does not exist."
    exit 1
fi

case "$WORKSHOP_NAME" in
    ""|*"/"*)
        echo "Error: Workshop item name must not be empty or contain '/'."
        exit 1
        ;;
esac

case "$INITIAL_MOD_ID" in
    ""|*[!A-Za-z0-9_.-]*)
        echo "Error: Initial mod id must use only letters, numbers, '.', '_' or '-'."
        exit 1
        ;;
esac

if [ -e "$TARGET_DIR" ]; then
    echo "Error: Workshop item '$TARGET_DIR' already exists."
    exit 1
fi

echo "Creating workshop item '$WORKSHOP_NAME' from pzmc-template..."
cp -R "$TEMPLATE_DIR" "$TARGET_DIR"
rm -rf "$TARGET_DIR/.git"

if [ ! -d "$PLACEHOLDER_MOD_DIR" ]; then
    echo "Error: Template is missing '$PLACEHOLDER_MOD_DIR'."
    exit 1
fi

mv "$PLACEHOLDER_MOD_DIR" "$TARGET_MOD_DIR"

escaped_workshop_name=$(printf '%s' "$WORKSHOP_NAME" | sed 's/[\\/&]/\\&/g')
escaped_initial_mod_id=$(printf '%s' "$INITIAL_MOD_ID" | sed 's/[\\/&]/\\&/g')

sed -i.bak "s/^title=.*/title=$escaped_workshop_name/" "$TARGET_DIR/workshop.txt"
rm -f "$TARGET_DIR/workshop.txt.bak"

for mod_info in "$TARGET_MOD_DIR/mod.info" "$TARGET_MOD_DIR/42/mod.info"; do
    if [ -f "$mod_info" ]; then
        sed -i.bak \
            -e "s/^id=.*/id=$escaped_initial_mod_id/" \
            -e "s/^name=.*/name=$escaped_initial_mod_id/" \
            "$mod_info"
        rm -f "$mod_info.bak"
    fi
done

echo "Success: created '$TARGET_DIR' with initial mod '$INITIAL_MOD_ID'."