#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <WorkshopItemName> <ModId>"
    echo "Example: $0 MyExampleWorkshop MySecondMod"
    exit 1
fi

WORKSHOP_NAME=$1
MOD_ID=$2
TEMPLATE_MOD_DIR="pzmc-template/Contents/mods/YOUR_MOD_HERE"
WORKSHOP_DIR="$WORKSHOP_NAME"
WORKSHOP_MODS_DIR="$WORKSHOP_DIR/Contents/mods"
TARGET_MOD_DIR="$WORKSHOP_MODS_DIR/$MOD_ID"

if [ ! -d "$WORKSHOP_DIR" ]; then
    echo "Error: Workshop item '$WORKSHOP_DIR' does not exist."
    exit 1
fi

if [ ! -d "$WORKSHOP_MODS_DIR" ]; then
    echo "Error: '$WORKSHOP_DIR' is missing Contents/mods."
    exit 1
fi

if [ ! -d "$TEMPLATE_MOD_DIR" ]; then
    echo "Error: Template mod directory '$TEMPLATE_MOD_DIR' does not exist."
    exit 1
fi

case "$MOD_ID" in
    ""|*[!A-Za-z0-9_.-]*)
        echo "Error: Mod id must use only letters, numbers, '.', '_' or '-'."
        exit 1
        ;;
esac

if [ -e "$TARGET_MOD_DIR" ]; then
    echo "Error: Mod '$MOD_ID' already exists in workshop item '$WORKSHOP_NAME'."
    exit 1
fi

echo "Adding mod '$MOD_ID' to workshop item '$WORKSHOP_NAME'..."
cp -R "$TEMPLATE_MOD_DIR" "$TARGET_MOD_DIR"

escaped_mod_id=$(printf '%s' "$MOD_ID" | sed 's/[\\/&]/\\&/g')

for mod_info in "$TARGET_MOD_DIR/mod.info" "$TARGET_MOD_DIR/42/mod.info"; do
    if [ -f "$mod_info" ]; then
        sed -i.bak \
            -e "s/^id=.*/id=$escaped_mod_id/" \
            -e "s/^name=.*/name=$escaped_mod_id/" \
            "$mod_info"
        rm -f "$mod_info.bak"
    fi
done

echo "Success: added '$MOD_ID' to '$WORKSHOP_NAME'."