/**
 * 本地缓存与生词本存储引擎 (基于 IndexedDB)
 */

const DB_NAME = 'LLMTranslatorCacheDB';
const DB_VERSION = 1;

class CacheDB {
  constructor() {
    this.db = null;
    this.initPromise = this._init();
  }

  async _init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;

        // 1. 翻译缓存表 (以 hash 为主键)
        if (!db.objectStoreNames.contains('translations')) {
          const transStore = db.createObjectStore('translations', { keyPath: 'hash' });
          transStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 2. 生词本表
        if (!db.objectStoreNames.contains('vocabulary')) {
          const vocabStore = db.createObjectStore('vocabulary', { keyPath: 'id', autoIncrement: true });
          vocabStore.createIndex('word', 'word', { unique: false });
          vocabStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 3. 术语库表
        if (!db.objectStoreNames.contains('glossary')) {
          const glossStore = db.createObjectStore('glossary', { keyPath: 'id', autoIncrement: true });
          glossStore.createIndex('term', 'term', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.warn('[CacheDB] 打开 IndexedDB 失败:', e);
        resolve(null);
      };
    });
  }

  // 计算简易字符串 Hash
  static hashKey(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return String(hash);
  }

  // ==================== 翻译缓存 ====================
  async getTranslation(sourceText, targetLang, mode) {
    await this.initPromise;
    if (!this.db) return null;

    const key = CacheDB.hashKey(`${targetLang}_${mode}_${sourceText.trim()}`);
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('translations', 'readonly');
        const store = tx.objectStore('translations');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.targetText : null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async setTranslation(sourceText, targetText, targetLang, mode) {
    await this.initPromise;
    if (!this.db || !targetText) return;

    const key = CacheDB.hashKey(`${targetLang}_${mode}_${sourceText.trim()}`);
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('translations', 'readwrite');
        const store = tx.objectStore('translations');
        store.put({
          hash: key,
          sourceText: sourceText.trim(),
          targetText: targetText.trim(),
          targetLang,
          mode,
          timestamp: Date.now()
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  // ==================== 生词本管理 ====================
  async addVocabulary({ word, context = '', translation = '', sourceLang = 'en', targetLang = 'zh-CN' }) {
    await this.initPromise;
    if (!this.db || !word) return false;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('vocabulary', 'readwrite');
        const store = tx.objectStore('vocabulary');
        store.add({
          word: word.trim(),
          context: context.trim(),
          translation: translation.trim(),
          sourceLang,
          targetLang,
          timestamp: Date.now()
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async getVocabularyList() {
    await this.initPromise;
    if (!this.db) return [];

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('vocabulary', 'readonly');
        const store = tx.objectStore('vocabulary');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  async deleteVocabulary(id) {
    await this.initPromise;
    if (!this.db) return false;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('vocabulary', 'readwrite');
        const store = tx.objectStore('vocabulary');
        store.delete(Number(id));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  // ==================== 专业术语库管理 ====================
  async getGlossaryList() {
    await this.initPromise;
    if (!this.db) return [];

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('glossary', 'readonly');
        const store = tx.objectStore('glossary');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  async addGlossaryTerm(term, translation, note = '') {
    await this.initPromise;
    if (!this.db || !term || !translation) return false;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('glossary', 'readwrite');
        const store = tx.objectStore('glossary');
        store.add({
          term: term.trim(),
          translation: translation.trim(),
          note: note.trim(),
          timestamp: Date.now()
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async deleteGlossaryTerm(id) {
    await this.initPromise;
    if (!this.db) return false;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('glossary', 'readwrite');
        const store = tx.objectStore('glossary');
        store.delete(Number(id));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }
}

export const dbInstance = new CacheDB();