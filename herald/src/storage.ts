
import * as fs from 'fs';
export const manifoldMap: {[k: string]: string} = loadOracleMap();

export function saveOracleMap() {
    fs.writeFileSync('keys.json', JSON.stringify(manifoldMap));
}

export function loadOracleMap() {
    try {
        return JSON.parse(fs.readFileSync('keys.json', 'utf8'));
    } catch (e) {
        if (!(e instanceof Error) || !e.message.includes('ENOENT')) throw e;
        return {};
    }
}