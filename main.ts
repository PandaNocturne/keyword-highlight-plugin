import { App, Plugin, MarkdownView, Notice, Setting, PluginSettingTab, Menu, MenuItem } from 'obsidian';

interface KeywordHighlightSettings {
  keywordPropertyName: string;
  colors: string[];
}

const DEFAULT_SETTINGS: KeywordHighlightSettings = {
  keywordPropertyName: 'keywords',
  colors: ['#ffadadff', '#ffd6a5ff', '#fdffb6ff', '#caffbfff', '#9bf6ffff', '#a0c4ffff', '#bdb2ffff', '#ffc6ffff'] // 更新默认颜色
};

export default class KeywordHighlightPlugin extends Plugin {
  private observer: MutationObserver;
  private debounceTimeout: number;
  private settings: KeywordHighlightSettings;

  getSettings() {
    return this.settings;
  }

  async onload() {
    console.log('Loading Keyword Highlight Plugin');
  
    // 加载设置
    await this.loadSettings();
  
    // 添加样式
    this.addStyles();
  
    // 添加右键菜单项
    this.addContextMenu();
  
    // 在笔记打开时高亮关键词
    this.registerEvent(this.app.workspace.on('file-open', this.highlightKeywords.bind(this)));
  
    // 监听阅读模式的变化
    this.registerEvent(this.app.workspace.on('layout-change', this.observeAndHighlight.bind(this)));
  
    // 添加设置选项
    this.addSettingTab(new KeywordHighlightSettingTab(this.app, this));
  
    // 添加阅读模式下的右键菜单项
    this.addReadingModeContextMenu();
  }
  
  addReadingModeContextMenu() {
    document.addEventListener('contextmenu', (event) => {
      const selection = window.getSelection()?.toString();
      if (!selection) return;
  
      const target = event.target as HTMLElement;
      if (target.closest('.markdown-preview-view')) {
        const menu = new Menu();
        menu.addItem((item: MenuItem) => { // 为 item 指定类型
          item.setTitle('Add to Keywords')
            .setIcon('star')
            .onClick(() => {
              const view = this.app.workspace.getActiveViewOfType(MarkdownView);
              if (view) {
                this.addKeyword(selection, view);
              }
            });
        });
        menu.showAtMouseEvent(event);
        event.preventDefault();
      }
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addStyles(); // 加载设置后添加样式
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  onunload() {
    console.log('Unloading Keyword Highlight Plugin');
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  addStyles() {
    const style = document.createElement('style');
    const colors = this.settings.colors;
    let styleContent = '';
  
    colors.forEach((color, index) => {
      styleContent += `
        .keyword-highlight-${index} { background-color: ${color}; }
      `;
    });
  
    style.textContent = styleContent;
    document.head.appendChild(style);
  }

  addContextMenu() {
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
      menu.addItem((item) => {
        item.setTitle('Add to Keywords')
          .setIcon('star')
          .onClick(() => {
            const selection = editor.getSelection();
            this.addKeyword(selection, view as MarkdownView);
          });
      });
    }));
  }

  async addKeyword(keyword: string, view: MarkdownView) {
    const file = view.file;
    if (!file) return; // 添加空值检查
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (!fm[this.settings.keywordPropertyName]) {
        fm[this.settings.keywordPropertyName] = [];
      }
      if (!fm[this.settings.keywordPropertyName].includes(keyword)) {
        fm[this.settings.keywordPropertyName].push(keyword);
      }
    });
  
    new Notice(`Keyword "${keyword}" added`);
    await this.highlightKeywords(); // 确保高亮更新
  }
  
  async highlightKeywords() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
  
    const file = view.file;
    if (!file) return; // 添加空值检查
  
    const keywords: string[] = [];
    await this.app.fileManager.processFrontMatter(file, fm => {
      if (fm[this.settings.keywordPropertyName]) {
        for (const i of fm[this.settings.keywordPropertyName]) {
          keywords.push(i);
        }
      }
    });
  
    // 处理阅读模式
    const contentEl = view.containerEl.querySelector('.markdown-preview-view .markdown-preview-section');
    if (contentEl) {
      this.highlightText(contentEl as HTMLElement, keywords);
    }
  }

  highlightText(contentEl: HTMLElement, keywords: string[]) {
    const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
    const nodesToHighlight: Text[] = [];
  
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (keywords.some(keyword => node.nodeValue!.includes(keyword))) {
        nodesToHighlight.push(node);
      }
    }
  
    nodesToHighlight.forEach(node => {
      const parent = node.parentNode;
      const frag = document.createDocumentFragment();
      let lastIndex = 0;
  
      keywords.forEach((keyword, index) => {
        const regex = new RegExp(`(${keyword})`, 'gi');
        let match;
        while ((match = regex.exec(node.nodeValue!)) !== null) {
          if (match.index > lastIndex) {
            frag.appendChild(document.createTextNode(node.nodeValue!.slice(lastIndex, match.index)));
          }
          const span = document.createElement('span');
          span.className = `keyword-highlight keyword-highlight-${index % this.settings.colors.length}`;
          span.textContent = match[1];
          frag.appendChild(span);
          lastIndex = regex.lastIndex;
        }
      });
  
      if (lastIndex < node.nodeValue!.length) {
        frag.appendChild(document.createTextNode(node.nodeValue!.slice(lastIndex)));
      }
  
      if (parent) {
        parent.replaceChild(frag, node);
      }
    });
  }

  observeAndHighlight() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    const contentEl = view.containerEl.querySelector('.markdown-preview-view .markdown-preview-section');
    if (!contentEl) return;

    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver(() => {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = window.setTimeout(() => {
        this.highlightKeywords();
      }, 300); // 300ms 防抖
    });

    this.observer.observe(contentEl, { childList: true, subtree: true });
  }
}

class KeywordHighlightSettingTab extends PluginSettingTab {
  plugin: KeywordHighlightPlugin;

  constructor(app: App, plugin: KeywordHighlightPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    containerEl.createEl('h2', { text: 'Keyword Highlight Plugin Settings' });

    new Setting(containerEl)
      .setName('Keyword Property Name')
      .setDesc('The name of the YAML property that contains the keywords.')
      .addText(text => text
        .setPlaceholder('Enter property name')
        .setValue(this.plugin.getSettings().keywordPropertyName)
        .onChange(async (value) => {
          this.plugin.getSettings().keywordPropertyName = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Highlight Colors')
      .setDesc('Comma-separated list of colors to use for highlighting keywords.')
      .addTextArea(text => text
        .setPlaceholder('Enter colors')
        .setValue(this.plugin.getSettings().colors.join(', '))
        .onChange(async (value) => {
          this.plugin.getSettings().colors = value.split(',').map(color => color.trim());
          await this.plugin.saveSettings();
          this.plugin.addStyles(); // 更新样式
        }));
  }
}