/**
 * Chrome 扩展本地开发全自动热重载看门狗 (Hot Reload Watcher)
 * 监听本地文件变动，只要修改并保存代码，自动触发 chrome.runtime.reload() 并刷新测试页面
 */

const filesInDirectory = (dir) =>
  new Promise((resolve) =>
    dir.createReader().readEntries((entries) =>
      Promise.all(
        entries
          .filter((e) => e.name[0] !== '.' && e.name !== 'node_modules')
          .map((e) =>
            e.isDirectory
              ? filesInDirectory(e)
              : new Promise((resolve) => e.file(resolve))
          )
      )
        .then((files) => [].concat(...files))
        .then(resolve)
    )
  );

const timestampForFilesInDirectory = (dir) =>
  filesInDirectory(dir).then((files) =>
    files.map((f) => f.name + (f.lastModifiedDate ? f.lastModifiedDate.getTime() : f.lastModified)).join('')
  );

const reload = () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].id && !tabs[0].url?.startsWith('chrome://')) {
      chrome.tabs.reload(tabs[0].id);
    }
    chrome.runtime.reload();
  });
};

const watchChanges = (dir, lastTimestamp) => {
  timestampForFilesInDirectory(dir).then((timestamp) => {
    if (!lastTimestamp || lastTimestamp === timestamp) {
      setTimeout(() => watchChanges(dir, timestamp), 1000); // 每秒轮询一次本地文件
    } else {
      console.log('[HotReload] ⚡ 检测到代码变动，正在全自动重载插件与测试网页...');
      reload();
    }
  }).catch(() => {
    setTimeout(() => watchChanges(dir, lastTimestamp), 2000);
  });
};

chrome.management.getSelf((self) => {
  if (self.installType === 'development') {
    chrome.runtime.getPackageDirectoryEntry((dir) => watchChanges(dir));
  }
});