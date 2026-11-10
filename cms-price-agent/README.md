# CMS Hospital Price Transparency Agent

An autonomous agent that discovers and downloads CMS-mandated hospital price transparency files using Claude Code with Firecrawl MCP tools.

## Overview

Since January 1, 2021, CMS requires hospitals to make their standard charges publicly available in machine-readable format. This agent automates the process of finding and downloading these files for any hospital.

### Features

- **Autonomous Discovery**: Uses Claude AI with Firecrawl web scraping to find price transparency pages
- **Multi-Strategy Search**: Searches hospital websites, CMS databases, and third-party aggregators
- **Smart File Detection**: Identifies machine-readable files (JSON, CSV, XML, XLSX)
- **Robust Downloading**: Handles large files with streaming, timeouts, and retry logic
- **Metadata Tracking**: Saves metadata about discovered and downloaded files
- **Interactive CLI**: User-friendly command-line interface with progress indicators

## Prerequisites

1. **Node.js 22+**
2. **Claude Code CLI** installed globally
3. **Anthropic API Key**
4. **Firecrawl API Key**

## Installation

```bash
# Navigate to the agent directory
cd cms-price-agent

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env and add your API keys
```

## Configuration

### Environment Variables

Create a `.env` file with:

```env
ANTHROPIC_API_KEY=your-anthropic-api-key
FIRECRAWL_API_KEY=your-firecrawl-api-key
```

### MCP Configuration

The `mcp-config.json` file configures Firecrawl as an MCP server:

```json
{
  "mcpServers": {
    "firecrawl": {
      "command": "npx",
      "args": ["-y", "firecrawl-mcp@3.39.0"],
      "env": {
        "FIRECRAWL_API_KEY": "${FIRECRAWL_API_KEY}"
      }
    }
  }
}
```

### API compatibility check

The MCP server is pinned to `firecrawl-mcp@3.39.0`, which uses Firecrawl API v2
for search, map, and scrape. Node.js 22+ is required by this server. Its deprecated
`firecrawl_extract` entry point returns a local error without calling the API.
Use `firecrawl_scrape` with markdown output and read the fields from that content
instead of either v1 or v2 Extract, which are retiring with v1.

Run `npm run test:firecrawl` from this directory to exercise the configured MCP
server over stdio and verify its real HTTP requests against a localhost mock.
The test uses a dummy API key, not your `.env`, and makes no paid Firecrawl calls.
The first run downloads the pinned npm package if it is not already cached.

## Usage

### Interactive Mode (Recommended)

```bash
npm run agent
```

This will prompt you for the hospital name and guide you through the process.

### Command Line Mode

```bash
# Search and download for a specific hospital
npm run agent -- search --name "Johns Hopkins Hospital"

# Search with verbose logging
npm run agent -- search --name "Mayo Clinic" --verbose

# Only discover files (no download)
npm run agent -- search --name "UCLA Medical Center" --no-download

# Custom output directory
npm run agent -- search --name "Cleveland Clinic" --output ./downloads
```

### Other Commands

```bash
# Check setup and dependencies
npm run agent -- check-setup

# List downloaded files
npm run agent -- list

# Show help
npm run agent -- --help
```

## How It Works

### Discovery Process

1. **Hospital Website Search**: Finds the hospital's official website
2. **Price Transparency Page Search**: Locates the billing/price transparency section
3. **File Discovery**: Identifies machine-readable file links using:
   - URL pattern matching
   - Page content analysis
   - Link extraction
4. **File Validation**: Verifies files match CMS requirements

### CMS File Patterns

The agent looks for files matching these patterns:

- `*standardcharges*`
- `*machine-readable*`
- `*price-transparency*`
- `*chargemaster*`
- `*cdm*`

With extensions: `.json`, `.csv`, `.xml`, `.xlsx`, `.xls`, `.txt`

## Output

Downloaded files are saved to `../public_prices/` (relative to agent directory) with:

- Sanitized filenames: `{hospital_name}_{timestamp}{extension}`
- Metadata JSON: `{hospital_name}_metadata.json`

### Example Output Structure

```
public_prices/
├── johns_hopkins_hospital_2024-01-15T10-30-00.json
├── johns_hopkins_hospital_metadata.json
├── mayo_clinic_2024-01-15T11-00-00.csv
└── mayo_clinic_metadata.json
```

### Metadata Format

```json
{
  "hospitalName": "Johns Hopkins Hospital",
  "scrapedAt": "2024-01-15T10:30:00.000Z",
  "filesDiscovered": 2,
  "filesDownloaded": 2,
  "files": [
    {
      "url": "https://...",
      "fileName": "standardcharges.json",
      "fileType": "json",
      "downloaded": true,
      "localPath": "../public_prices/johns_hopkins_hospital_2024-01-15T10-30-00.json"
    }
  ]
}
```

## Architecture

```
cms-price-agent/
├── src/
│   ├── index.ts                 # CLI entry point
│   ├── agents/
│   │   └── price-scraper-agent.ts  # Main agent logic
│   ├── types/
│   │   └── index.ts             # TypeScript types and schemas
│   └── utils/
│       ├── logger.ts            # Logging utilities
│       ├── file-ops.ts          # File operations
│       └── index.ts             # Utils barrel export
├── mcp-config.json              # Firecrawl MCP configuration
├── package.json
├── tsconfig.json
└── README.md
```

## Troubleshooting

### "Claude CLI not found"

Install Claude Code globally:

```bash
npm install -g @anthropic-ai/claude-code
```

### "ANTHROPIC_API_KEY not set"

Make sure you've created a `.env` file with your API key:

```bash
export ANTHROPIC_API_KEY=your-key-here
```

### "Firecrawl connection failed"

1. Verify your Firecrawl API key is valid
2. Check your internet connection
3. Ensure `npx -y firecrawl-mcp@3.39.0` can run

### "No files found"

Some hospitals may:

- Use different branding (try searching for parent health system)
- Host files on third-party platforms
- Not be compliant with CMS requirements

Try searching with variations of the hospital name or the parent health system name.

## Limitations

- Requires active Firecrawl subscription for web scraping
- Some hospitals use CAPTCHAs or bot protection
- Very large files (>1GB) may timeout
- Rate limiting may apply to some hospital websites

## License

MIT
