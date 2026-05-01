# Gmail Bulk Mail Sender (HTML + CSS + JS)

Simple app to send bulk Gmail emails by uploading a CSV file.

## Features
- Upload CSV with recipients
- Use placeholders in subject/body (`{{columnName}}`)
- Sends mails via Gmail SMTP
- Shows sent/failed summary

## CSV format
Required column:
- `email`

Example:
```csv
email,name,company
alice@example.com,Alice,Acme
bob@example.com,Bob,Globex
```

Then templates can use:
- Subject: `Hello {{name}}`
- Body: `Hi {{name}}, welcome to {{company}}.`

## Setup
1. Install Node.js 18+
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run app:
   ```bash
   npm start
   ```
4. Open:
   `http://localhost:3000`

## Gmail requirement
Use a Gmail **App Password** (not your normal password):
- Enable 2-Step Verification in your Google account
- Create App Password and paste it in the form

## Notes
- For very large lists, Gmail daily limits apply.
- Test with a few emails first.