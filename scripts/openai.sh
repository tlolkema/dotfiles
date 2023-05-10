#!/bin/bash

if [  ! -n "$OPENAI_API_KEY" ]
  then
    echo "ERROR: Please set an environment variable for OPENAI_API_KEY"
    exit 1
fi

clean_input=$(printf '%s' "$1" | tr -d '"' | tr -d '\n')

response=$(curl -s https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "'"$clean_input"'"}]
  }')

generated_text=$(printf '%s' "$response" | jq '.choices[0].message.content' | sed -e 's/^"//' -e 's/"$//')

printf "$generated_text\n"
printf "$generated_text\n" | pbcopy
