# Frontend

pnpm + vite + reach + typescript

"Always use docker to run the frontend, never run it locally."

Create a user webpage for proof of concept.
Query local supabase db for order transaction data and display it in a table.

Create a local db as follows:
Create 1 dummy admin user and 2 dummy customer users in the local supabase db.
Create 2 dummy companies, 2 dummy company fees for each dummy user.

Create order transaction table from the real amazon SP-API. Download the data of the last 60 days.