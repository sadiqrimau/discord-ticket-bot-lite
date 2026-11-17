# Discord Ticket Bot Lite

A small, dependency-light Discord ticket bot built with [discord.js](https://discord.js.org) v14 and SQLite.

## Features
- Button-based ticket panel, one open ticket per user
- Private ticket channels visible only to the opener and your staff role
- **Claim** button so staff don't answer over each other
- **Discord-style HTML transcripts** posted to a log channel and sent to the ticket owner by DM
- Ticket data stored in SQLite, so state survives restarts
- Tickets are closed automatically in the database if a channel is deleted by hand
- Input is escaped in transcripts, so message content can't inject HTML

## Commands
| Command | Who | What it does |
|---|---|---|
| `/ticketpanel` | Admin | Posts the "Open Ticket" panel in the current channel |
| `/ticketstats` | Admin | Shows total, open and closed ticket counts |

## Requirements
Node.js 22.13 or newer. SQLite is built into Node, so there is nothing to compile and `npm install` works on Windows, macOS and Linux without build tools.

## Setup
1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications) and add a bot.
2. Under **Bot**, enable **Message Content Intent** (needed so transcripts contain message text).
3. Invite the bot with the scopes `bot` and `applications.commands` and the permissions
   *View Channels, Send Messages, Manage Channels, Read Message History, Embed Links, Attach Files*.
4. Create a staff role, a category for tickets and a private log channel. If the log channel is private, add the bot (or its role) there with *View Channel, Send Messages and Attach Files*, otherwise transcripts can't be posted.
5. Install and configure:
   ```bash
   git clone https://github.com/sadiqrimau/discord-ticket-bot-lite.git
   npm install
   cp .env.example .env  # then fill in the IDs and Windows users can run copy .env.example .env. 
   npm start
   ```
6. In the channel you want, run `/ticketpanel`.

Enable Developer Mode in Discord (Settings > Advanced) to copy role, channel and server IDs.

## Hosting notes
Set `DB_PATH` to a persistent location (for example a mounted volume). On hosts with ephemeral disks, the database is wiped on every redeploy.

## Known limitations
- Commands are registered for a single server (`GUILD_ID`).
- Images up to 3 MB each (5 MB per transcript) are embedded in the transcript so they keep working. Larger images fall back to Discord links, which expire after about 24 hours.
- One ticket category and one staff role per bot instance.

## Contributing
Issues and pull requests are welcome.

## License
MIT. See [LICENSE](LICENSE).
