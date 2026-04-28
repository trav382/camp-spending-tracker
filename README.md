# Camp Spending Tracker

A local one-person camp spending tracker. The app runs on your computer with Node/Express and stores data in a local SQLite database file.

## Run Locally

Install dependencies once:

```bash
npm install
```

Start the app:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

## Data

The SQLite database is created here:

```text
data/camp-spending.db
```

Manual backups are created here:

```text
backups/
```

Both folders are ignored by Git so private camp data does not get pushed to GitHub.
