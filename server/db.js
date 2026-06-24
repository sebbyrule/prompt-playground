import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getFilePath(filename) {
  return path.join(DATA_DIR, filename);
}

function readJsonFile(filename, defaultValue = []) {
  const filePath = getFilePath(filename);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error(`Error reading database file ${filename}:`, error);
  }
  return defaultValue;
}

function writeJsonFile(filename, data) {
  const filePath = getFilePath(filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error(`Error writing database file ${filename}:`, error);
    return false;
  }
}

export const db = {
  getProjects: () => readJsonFile('projects.json', []),
  saveProjects: (projects) => writeJsonFile('projects.json', projects),
  
  getRuns: () => readJsonFile('runs.json', []),
  saveRuns: (runs) => writeJsonFile('runs.json', runs),
  
  getEvaluations: () => readJsonFile('evaluations.json', []),
  saveEvaluations: (evals) => writeJsonFile('evaluations.json', evals),

  getTools: () => readJsonFile('tools.json', []),
  saveTools: (tools) => writeJsonFile('tools.json', tools),

  getSkills: () => readJsonFile('skills.json', []),
  saveSkills: (skills) => writeJsonFile('skills.json', skills),

  getSessions: () => readJsonFile('sessions.json', []),
  saveSessions: (sessions) => writeJsonFile('sessions.json', sessions)
};
