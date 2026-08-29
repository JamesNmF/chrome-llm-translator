/**
 * 本地缓存与生词本存储引擎 (基于 IndexedDB，带脏数据自清洁机制)
 */

const DB_NAME = 'LLMTranslatorCacheDB';
const DB_VERSION = 2; // 升级版本号自动清理老脏数据

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
        if (db.objectStoreNames.contains('translations')) {
          db.deleteObjectStore('translations'); // 升级时清空旧版本脏缓存
        }
        const transStore = db.createObjectStore('translations', { keyPath: 'hash' });
        transStore.createIndex('timestamp', 'timestamp', { unique: false });

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

  // 脏回复判定
  static isGarbageTranslation(text) {
    if (!text || typeof text !== 'string') return true;
    const t = text.trim();
    if (t.length === 0) return true;
    const garbagePatterns = [
      /好的[，,\s]*请提供需要翻译/i,
      /请提供需要翻译的内容/i,
      /我准备好了[，,\s]*请发送/i,
      /作为[一个]*AI[语言模型]*/i,
      /很高兴为您服务[，,\s]*请发送/i,
      /I am ready to translate/i,
      /Please provide the text you would like to translate/i
    ];
    return garbagePatterns.some(p => p.test(t));
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
        const tx = this.db.transaction('translations', 'readwrite');
        const store = tx.objectStore('translations');
        const req = store.get(key);
        req.onsuccess = () => {
          if (req.result) {
            const cachedText = req.result.targetText;
            if (CacheDB.isGarbageTranslation(cachedText)) {
              store.delete(key); // 自动清除脏缓存
              resolve(null);
            } else {
              resolve(cachedText);
            }
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async setTranslation(sourceText, targetText, targetLang, mode) {
    await this.initPromise;
    if (!this.db || !targetText) return;
    if (CacheDB.isGarbageTranslation(targetText)) return; // 脏数据坚决不入库

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

  async clearAllTranslations() {
    await this.initPromise;
    if (!this.db) return false;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('translations', 'readwrite');
        const store = tx.objectStore('translations');
        store.clear();
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
        store.delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  // ==================== 术语库管理 ====================
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

  async deleteGlossaryTerm(id) {
    await this.initPromise;
    if (!this.db) return false;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('glossary', 'readwrite');
        const store = tx.objectStore('glossary');
        store.delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }
}

export const dbInstance = new CacheDB();