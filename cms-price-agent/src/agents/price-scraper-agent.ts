import { spawn } from 'child_process';
import { join, resolve } from 'path';
import { logger } from '../utils/logger.js';
import { downloadFile, ensureDirectory, saveMetadata, cleanupPartialDownloads } from '../utils/file-ops.js';
import type { PriceFile, DownloadResult, AgentConfig, AgentState } from '../types/index.js';
import { DEFAULT_AGENT_CONFIG, CMS_FILE_PATTERNS } from '../types/index.js';

/**
 * CMS Hospital Price Scraper Agent
 *
 * This agent uses Claude Code with Firecrawl MCP tools to:
 * 1. Search for hospital price transparency pages
 * 2. Discover machine-readable file URLs
 * 3. Download files to the public_prices directory
 */
export class CMSPriceScraperAgent {
  private config: AgentConfig;
  private state: AgentState;

  constructor(hospitalName: string, config: Partial<AgentConfig> = {}) {
    this.config = { ...DEFAULT_AGENT_CONFIG, ...config };
    this.state = {
      sessionId: this.generateSessionId(),
      hospitalName,
      status: 'searching',
      discoveredFiles: [],
      downloadedFiles: [],
      errors: [],
      startedAt: new Date().toISOString(),
    };
  }

  private generateSessionId(): string {
    return `cms-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Build the comprehensive prompt for the Claude agent
   */
  private buildAgentPrompt(): string {
    const { hospitalName } = this.state;

    return `
You are a CMS Hospital Price Transparency File Discovery Agent. Your mission is to find and identify machine-readable price transparency files for "${hospitalName}".

## BACKGROUND
Since January 1, 2021, CMS requires hospitals to post machine-readable files containing their standard charges. These files must be:
- In a machine-readable format (JSON, CSV, XML, or XLSX)
- Named following CMS guidelines (typically containing "standardcharges" or "machine-readable")
- Publicly accessible without barriers

## YOUR TASK

### Step 1: Find the Hospital's Official Website
Use firecrawl_search to find the official website for "${hospitalName}". Search queries to try:
- "${hospitalName} official website"
- "${hospitalName} hospital"

### Step 2: Find the Price Transparency Page
Once you have the hospital's domain, use firecrawl_search or firecrawl_map to find their price transparency page:
- Search: "${hospitalName} price transparency machine readable file"
- Search: "${hospitalName} standard charges"
- Search: "site:[hospital-domain] price transparency"
- Search: "site:[hospital-domain] standard charges"
- Map the hospital domain to find URLs containing: price, transparency, charges, billing

### Step 3: Locate Machine-Readable Files
On the price transparency page, look for:
${CMS_FILE_PATTERNS.keywords.map(k => `- URLs containing "${k}"`).join('\n')}

File extensions to look for: ${CMS_FILE_PATTERNS.validExtensions.join(', ')}

Use firecrawl_scrape with formats: ["markdown", "links"] to examine the page content and find download links.
Do not use firecrawl_extract: Extract is retired. Read structured fields directly from the scraped content.

### Step 4: Extract and Validate File URLs
For each potential file found:
1. Verify it's a direct download link (ends in valid extension or is a file download)
2. Note the file size if available
3. Classify the file type

## OUTPUT FORMAT
Return a JSON object with this exact structure:
\`\`\`json
{
  "hospitalName": "${hospitalName}",
  "hospitalWebsite": "https://...",
  "priceTransparencyPage": "https://...",
  "files": [
    {
      "url": "https://direct-download-url",
      "fileName": "hospital_standardcharges.json",
      "fileType": "json",
      "description": "Main standard charges file"
    }
  ],
  "notes": "Any relevant observations"
}
\`\`\`

## IMPORTANT GUIDELINES
1. Only return DIRECT download URLs for machine-readable files
2. Prefer JSON files, then CSV, then XML
3. Look for the most recent/comprehensive file if multiple versions exist
4. If the hospital uses a third-party transparency platform (like Turquoise Health), follow those links
5. Some hospitals host files on CDNs or separate domains - that's acceptable
6. If you cannot find files after thorough searching, explain what you found and why files might not be available

## SEARCH STRATEGIES TO TRY
1. Direct hospital website search
2. CMS hospital compare database
3. State health department databases
4. Third-party aggregators (Turquoise Health, PatientRightsAdvocate.org)

Begin your search now for "${hospitalName}".
`;
  }

  /**
   * Execute the Claude agent to discover price files
   */
  async discoverFiles(): Promise<PriceFile[]> {
    logger.banner(`CMS Price File Discovery Agent`);
    logger.info(`Hospital: ${this.state.hospitalName}`);
    logger.info(`Session: ${this.state.sessionId}`);
    logger.divider();

    this.state.status = 'searching';

    try {
      const prompt = this.buildAgentPrompt();
      const result = await this.executeClaudeAgent(prompt);

      // Parse the agent's response
      const files = this.parseAgentResponse(result);
      this.state.discoveredFiles = files;

      logger.success(`Discovered ${files.length} potential price file(s)`);
      return files;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.state.errors.push(`Discovery failed: ${errorMessage}`);
      this.state.status = 'failed';
      logger.error(`Discovery failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Execute Claude Code CLI with Firecrawl MCP tools
   */
  private async executeClaudeAgent(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      logger.info('Starting Claude agent with Firecrawl MCP tools...');

      const claudeProcess = spawn('claude', [
        '--print',
        '--dangerously-skip-permissions',
        '--mcp-config', join(process.cwd(), 'mcp-config.json'),
        '-p', prompt
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      claudeProcess.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        if (this.config.verbose) {
          process.stdout.write(text);
        }
      });

      claudeProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      claudeProcess.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Claude agent exited with code ${code}: ${stderr}`));
        }
      });

      claudeProcess.on('error', (err) => {
        reject(new Error(`Failed to start Claude agent: ${err.message}`));
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        claudeProcess.kill();
        reject(new Error('Claude agent timed out after 5 minutes'));
      }, 300000);
    });
  }

  /**
   * Parse the agent's response to extract file information
   */
  private parseAgentResponse(response: string): PriceFile[] {
    const files: PriceFile[] = [];

    try {
      // Try to find JSON in the response
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.files && Array.isArray(parsed.files)) {
          for (const file of parsed.files) {
            if (file.url) {
              files.push({
                url: file.url,
                fileName: file.fileName || this.extractFilename(file.url),
                fileType: this.detectFileType(file.url),
                hospitalName: this.state.hospitalName,
                discoveredAt: new Date().toISOString(),
                description: file.description,
              });
            }
          }
        }
      }

      // Also try to find raw URLs in the response
      const urlRegex = /https?:\/\/[^\s"'<>]+\.(json|csv|xml|xlsx?|txt)/gi;
      const urlMatches = response.match(urlRegex) || [];

      for (const url of urlMatches) {
        if (!files.some(f => f.url === url)) {
          files.push({
            url,
            fileName: this.extractFilename(url),
            fileType: this.detectFileType(url),
            hospitalName: this.state.hospitalName,
            discoveredAt: new Date().toISOString(),
          });
        }
      }
    } catch (error) {
      logger.warn('Failed to parse some agent response:', error);
    }

    return files;
  }

  /**
   * Extract filename from URL
   */
  private extractFilename(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop() || 'unknown';
      return decodeURIComponent(filename);
    } catch {
      return 'unknown';
    }
  }

  /**
   * Detect file type from URL
   */
  private detectFileType(url: string): PriceFile['fileType'] {
    const lower = url.toLowerCase();
    if (lower.includes('.json')) return 'json';
    if (lower.includes('.csv')) return 'csv';
    if (lower.includes('.xml')) return 'xml';
    if (lower.includes('.xlsx') || lower.includes('.xls')) return 'xlsx';
    if (lower.includes('.txt')) return 'txt';
    return 'other';
  }

  /**
   * Download all discovered files
   */
  async downloadFiles(): Promise<DownloadResult[]> {
    if (this.state.discoveredFiles.length === 0) {
      logger.warn('No files to download');
      return [];
    }

    logger.divider();
    logger.step(1, 2, 'Preparing download directory');

    const outputDir = resolve(process.cwd(), this.config.outputDir);
    await ensureDirectory(outputDir);
    await cleanupPartialDownloads(outputDir);

    logger.step(2, 2, `Downloading ${this.state.discoveredFiles.length} file(s)`);
    this.state.status = 'downloading';

    const results: DownloadResult[] = [];

    for (let i = 0; i < this.state.discoveredFiles.length; i++) {
      const file = this.state.discoveredFiles[i];
      logger.info(`[${i + 1}/${this.state.discoveredFiles.length}] ${file.fileName}`);

      const result = await downloadFile(
        file.url,
        outputDir,
        this.state.hospitalName,
        this.config.downloadTimeout
      );

      results.push(result);

      if (!result.success) {
        this.state.errors.push(`Failed to download ${file.url}: ${result.error}`);
      }

      // Small delay between downloads to be polite
      if (i < this.state.discoveredFiles.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    this.state.downloadedFiles = results;

    // Save metadata
    await saveMetadata(outputDir, this.state.hospitalName, this.state.discoveredFiles, results);

    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;

    logger.divider();
    if (successCount > 0) {
      logger.success(`Downloaded ${successCount} file(s) successfully`);
    }
    if (failCount > 0) {
      logger.warn(`Failed to download ${failCount} file(s)`);
    }

    this.state.status = successCount > 0 ? 'completed' : 'failed';
    this.state.completedAt = new Date().toISOString();

    return results;
  }

  /**
   * Run the full agent pipeline
   */
  async run(): Promise<AgentState> {
    try {
      await this.discoverFiles();
      await this.downloadFiles();
    } catch (error) {
      this.state.status = 'failed';
      this.state.completedAt = new Date().toISOString();
    }

    return this.state;
  }

  /**
   * Get current agent state
   */
  getState(): AgentState {
    return { ...this.state };
  }
}
