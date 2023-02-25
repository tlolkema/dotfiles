#!/bin/bash

if [  ! -n "$OPENAI_API_KEY" ]
  then
    echo "ERROR: Please set an environment variable for OPENAI_API_KEY"
    exit 1
fi

response=$(curl -s https://api.openai.com/v1/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
  "model": "text-davinci-003",
  "prompt": "'"$1"'",
  "temperature": 0.1,
  "max_tokens": 600
}')

generated_text=$(printf '%s' "$response" | jq '.choices[].text' | tr -d '"' | cut -c 3-)

printf "$generated_text\n"
printf "$generated_text\n" | pbcopy

