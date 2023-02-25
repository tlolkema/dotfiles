response=$(curl -s https://api.openai.com/v1/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
  "model": "text-davinci-003",
  "prompt": "'"$1"'",
  "temperature": 0.1,
  "max_tokens": 600
}')

generated_text=$(echo "$response" | tr -d '\r' | tr -d '\n' | jq '.choices[].text' | tr -d '"')

printf "$generated_text"
printf "$generated_text" | pbcopy
