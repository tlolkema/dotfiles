response=$(curl -s https://api.openai.com/v1/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
  "model": "text-davinci-003",
  "prompt": "'"$1"'",
  "temperature": 0,
  "max_tokens": 200
}')

generated_text=$(echo "$response" | tr -d '\r' | tr -d '\n' | jq '.choices[].text' | tr -d '"')

echo "$generated_text"
echo "$generated_text" | pbcopy
