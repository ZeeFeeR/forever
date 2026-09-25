// ==UserScript==
// @name         Talents Forever RU (DB2)
// @namespace    https://github.com/ZeeFeeR/wow-builder
// @version      0.1.0
// @description  Русская локализация talentsforever.com поверх оригинального сайта на основе ruRU DB2 WoW Forever.
// @author       ZeeFeeR
// @match        https://talentsforever.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      talentsforever.com
// @connect      raw.githubusercontent.com
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.1.0';
  const TF_DATA_URL = 'https://talentsforever.com/data.json';
  const RU_DATA_BASE = 'https://raw.githubusercontent.com/ZeeFeeR/forever/main/data';
  const STATUS_ID = 'tfru-status';

  const CLASSES = {
    warrior: 'Warrior',
    paladin: 'Paladin',
    hunter: 'Hunter',
    rogue: 'Rogue',
    priest: 'Priest',
    shaman: 'Shaman',
    mage: 'Mage',
    warlock: 'Warlock',
    druid: 'Druid'
  };

  const UI_TRANSLATIONS = new Map([
    ['Level', 'Уровень'],
    ['Reset', 'Сбросить'],
    ['Copy link', 'Скопировать ссылку'],
    ['Stream layout', 'Компактный вид'],
    ['Compare to Classic', 'Сравнить с Classic'],
    ['Talents', 'Таланты'],
    ['Reset build', 'Сбросить билд'],
    ['Leveling order', 'Порядок прокачки'],
    ['Your points, level by level.', 'Ваши очки по уровням.'],
    ['Show', 'Показать'],
    ['Hide', 'Скрыть'],
    ['My builds', 'Мои билды'],
    ['Save this build', 'Сохранить билд'],
    ['Name this build', 'Название билда'],
    ['Save', 'Сохранить'],
    ['Cancel', 'Отмена'],
    ['Back up', 'Резервная копия'],
    ['Restore', 'Восстановить'],
    ['Add builds', 'Добавить билды'],
    ['Share', 'Поделиться'],
    ['Send to a friend', 'Отправить другу'],
    ['Theorycraft', 'Теорикрафт'],
    ['Copy build for AI', 'Скопировать билд для ИИ'],
    ['Raw data', 'Исходные данные'],
    ['Racials', 'Расовые способности'],
    ["Show races that can't be this class", 'Показать расы, недоступные этому классу'],
    ['Legacy perks', 'Наследие'],
    ['How it works', 'Как это работает'],
    ['From the beta client', 'Из beta-клиента'],
    ['Readers catch the rest', 'Остальное находят игроки'],
    ['Calculators:', 'Калькуляторы:'],
    ['On this site:', 'На сайте:'],
    ['Warrior', 'Воин'],
    ['Paladin', 'Паладин'],
    ['Hunter', 'Охотник'],
    ['Rogue', 'Разбойник'],
    ['Priest', 'Жрец'],
    ['Shaman', 'Шаман'],
    ['Mage', 'Маг'],
    ['Warlock', 'Чернокнижник'],
    ['Druid', 'Друид'],
    ['New in Forever', 'Новое в Forever'],
    ['Changed (text, ranks or position)', 'Изменено (текст, ранги или позиция)'],
    ['Moved, same effect', 'Перемещено, эффект тот же'],
    ['Dimmed = unchanged from Classic', 'Затемнено = без изменений относительно Classic'],
    ['Unlearn', 'Убрать'],
    ['Learn', 'Изучить']
  ]);

  const translations = new Map();
  const originalText = new Map();
  const originalAttributes = new Map();
  let enabled = localStorage.getItem('tfru-enabled') !== '0';
  let observer = null;
  let scheduled = false;
  let currentBuild = null;
  let siteBuild = null;
  let matchedTalents = 0;
  let totalTalents = 0;

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function addTranslation(source, target) {
    const from = normalizeText(source);
    const to = normalizeText(target);
    if (!from || !to || from === to) return;
    if (!translations.has(from)) translations.set(from, to);
  }

  for (const [source, target] of UI_TRANSLATIONS) addTranslation(source, target);

  function requestJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { Accept: 'application/json' },
        timeout: 20000,
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`HTTP ${response.status} for ${url}`));
            return;
          }
          try {
            resolve(JSON.parse(response.responseText));
          } catch (error) {
            reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
          }
        },
        onerror: () => reject(new Error(`Network error for ${url}`)),
        ontimeout: () => reject(new Error(`Timeout for ${url}`))
      });
    });
  }

  function getClassSlug() {
    const slug = location.pathname.split('/').filter(Boolean)[0]?.toLowerCase() || 'warrior';
    return CLASSES[slug] ? slug : null;
  }

  function extractSiteBuild(tfData, className) {
    const source = tfData?.talents?.[className]?.source || '';
    const sourceMatch = String(source).match(/build\s+([0-9.]+)/i);
    if (sourceMatch) return sourceMatch[1];

    const spellbookBuild = tfData?.spellbooks?.[className]?.build;
    return spellbookBuild ? String(spellbookBuild) : null;
  }

  function findLocalTree(localData, tfTree, treeIndex) {
    const targetName = normalizeText(tfTree?.name).toLowerCase();
    return localData.trees.find((tree) => normalizeText(tree?.name?.enUS).toLowerCase() === targetName)
      || localData.trees.find((tree) => Number(tree.order) === treeIndex)
      || localData.trees[treeIndex]
      || null;
  }

  function findLocalTalent(localTree, tfTalent) {
    const row = Number(tfTalent.row) - 1;
    const column = Number(tfTalent.col) - 1;

    return localTree.talents.find((talent) => talent.row === row && talent.column === column)
      || localTree.talents.find(
        (talent) => normalizeText(talent?.name?.enUS).toLowerCase() === normalizeText(tfTalent?.name).toLowerCase()
      )
      || null;
  }

  function buildTalentTranslations(tfData, localData, className) {
    const tfClass = tfData?.talents?.[className];
    if (!tfClass || !Array.isArray(tfClass.trees)) {
      throw new Error(`Talents Forever has no talent data for ${className}`);
    }

    addTranslation(className, localData?.class?.name?.ruRU);

    matchedTalents = 0;
    totalTalents = 0;

    tfClass.trees.forEach((tfTree, treeIndex) => {
      const localTree = findLocalTree(localData, tfTree, treeIndex);
      if (!localTree) return;

      addTranslation(tfTree.name, localTree?.name?.ruRU);

      for (const tfTalent of tfTree.talents || []) {
        totalTalents += 1;
        const localTalent = findLocalTalent(localTree, tfTalent);
        if (!localTalent) continue;
        matchedTalents += 1;

        addTranslation(tfTalent.name, localTalent?.name?.ruRU);

        const tfDescriptions = Array.isArray(tfTalent.desc) ? tfTalent.desc : [];
        const localRanks = Array.isArray(localTalent.ranks) ? localTalent.ranks : [];
        const rankCount = Math.min(tfDescriptions.length, localRanks.length);

        for (let index = 0; index < rankCount; index += 1) {
          addTranslation(tfDescriptions[index], localRanks[index]?.description?.ruRU);
        }

        if (tfTalent.req) {
          const reqLocal = localTree.talents.find(
            (talent) => normalizeText(talent?.name?.enUS).toLowerCase() === normalizeText(tfTalent.req).toLowerCase()
          );
          if (reqLocal?.name?.ruRU) {
            addTranslation(`Requires ${tfTalent.req}`, `Требуется: ${reqLocal.name.ruRU}`);
          }
        }
      }
    });
  }

  function translateDynamic(core) {
    let match;

    if ((match = core.match(/^Points left:\s*(\d+)$/i))) return `Осталось очков: ${match[1]}`;
    if ((match = core.match(/^Level needed:\s*(\d+)$/i))) return `Нужный уровень: ${match[1]}`;
    if ((match = core.match(/^Rank\s+(\d+)(?:\/(\d+))?$/i))) {
      return match[2] ? `Ранг ${match[1]}/${match[2]}` : `Ранг ${match[1]}`;
    }
    if ((match = core.match(/^(\d+)\s+Points?$/i))) return `${match[1]} очк.`;
    if ((match = core.match(/^(\d+)\s+points?$/i))) return `${match[1]} очк.`;
    if ((match = core.match(/^Requires\s+(\d+)\s+points?\s+in\s+(.+)$/i))) {
      return `Требуется ${match[1]} очк. в ветке «${translations.get(normalizeText(match[2])) || match[2]}»`;
    }

    return null;
  }

  function translatePartial(value) {
    let text = value;

    const replacements = [
      [/\bRank\s+(\d+)\b/gi, 'Ранг $1'],
      [/\bRequires\b/gi, 'Требуется'],
      [/\bMelee Range\b/gi, 'Ближний бой'],
      [/\bInstant\b/gi, 'Мгновенно'],
      [/\bsec cooldown\b/gi, 'сек. восстановления'],
      [/\bmin cooldown\b/gi, 'мин. восстановления'],
      [/\byd range\b/gi, 'м дальность'],
      [/\bRage\b/gi, 'ярости'],
      [/\bMana\b/gi, 'маны']
    ];

    for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
    return text;
  }

  function translatedValue(raw) {
    const value = String(raw ?? '');
    const leading = value.match(/^\s*/)?.[0] || '';
    const trailing = value.match(/\s*$/)?.[0] || '';
    const core = normalizeText(value);
    if (!core) return value;

    const exact = translations.get(core);
    const dynamic = exact ? null : translateDynamic(core);
    const translated = exact || dynamic || translatePartial(core);

    if (!translated || translated === core) return value;
    return `${leading}${translated}${trailing}`;
  }

  function isOurUi(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return Boolean(element?.closest?.(`#${STATUS_ID}`));
  }

  function shouldSkipTextNode(node) {
    if (!node?.parentElement || isOurUi(node)) return true;
    return ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE'].includes(node.parentElement.tagName);
  }

  function translateTextNode(node) {
    if (!enabled || shouldSkipTextNode(node)) return;
    const before = node.nodeValue || '';
    const after = translatedValue(before);
    if (after === before) return;

    if (!originalText.has(node)) originalText.set(node, before);
    node.nodeValue = after;
  }

  function translateAttributes(element) {
    if (!enabled || !(element instanceof Element) || isOurUi(element)) return;

    const attributes = ['placeholder', 'title', 'aria-label', 'value'];
    for (const name of attributes) {
      if (!element.hasAttribute(name)) continue;
      if (name === 'value' && !['INPUT', 'BUTTON'].includes(element.tagName)) continue;

      const before = element.getAttribute(name);
      if (before == null) continue;
      const after = translatedValue(before);
      if (after === before) continue;

      let saved = originalAttributes.get(element);
      if (!saved) {
        saved = new Map();
        originalAttributes.set(element, saved);
      }
      if (!saved.has(name)) saved.set(name, before);
      element.setAttribute(name, after);
    }
  }

  function translateSubtree(root) {
    if (!enabled || !root) return;

    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }

    if (!(root instanceof Element) && root !== document) return;
    if (root instanceof Element) translateAttributes(root);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      else if (node.nodeType === Node.ELEMENT_NODE) translateAttributes(node);
      node = walker.nextNode();
    }
  }

  function restoreOriginals() {
    for (const [node, value] of originalText) {
      if (node.isConnected) node.nodeValue = value;
    }
    originalText.clear();

    for (const [element, attrs] of originalAttributes) {
      if (!element.isConnected) continue;
      for (const [name, value] of attrs) element.setAttribute(name, value);
    }
    originalAttributes.clear();
  }

  function scheduleTranslate(root = document) {
    if (!enabled || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      translateSubtree(root);
      updateStatus();
    });
  }

  function observeDom() {
    observer?.disconnect();
    observer = new MutationObserver((mutations) => {
      if (!enabled) return;

      const hasRelevantMutation = mutations.some(
        (mutation) =>
          mutation.type === 'characterData' ||
          (mutation.type === 'childList' && mutation.addedNodes.length > 0)
      );

      if (hasRelevantMutation) scheduleTranslate(document);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function ensureStatus() {
    let root = document.getElementById(STATUS_ID);
    if (root) return root;

    root = document.createElement('button');
    root.id = STATUS_ID;
    root.type = 'button';
    root.title = 'Talents Forever RU: нажмите, чтобы включить/выключить перевод';
    Object.assign(root.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      zIndex: '2147483647',
      border: '1px solid rgba(255,255,255,.18)',
      borderRadius: '8px',
      padding: '7px 10px',
      background: 'rgba(12,12,14,.94)',
      color: '#e8e8ea',
      font: '12px/1.25 system-ui, sans-serif',
      cursor: 'pointer',
      boxShadow: '0 4px 16px rgba(0,0,0,.35)'
    });

    root.addEventListener('click', () => {
      enabled = !enabled;
      localStorage.setItem('tfru-enabled', enabled ? '1' : '0');
      if (enabled) translateSubtree(document);
      else restoreOriginals();
      updateStatus();
    });

    document.documentElement.appendChild(root);
    return root;
  }

  function updateStatus(message = null, isError = false) {
    const root = ensureStatus();
    const sameBuild = currentBuild && siteBuild && currentBuild === siteBuild;
    const state = enabled ? 'RU ON' : 'RU OFF';
    const buildText = currentBuild ? `DB ${currentBuild}` : 'UI';
    const matchText = totalTalents ? ` · ${matchedTalents}/${totalTalents}` : '';
    root.textContent = message || `${state} · ${buildText}${matchText}`;
    root.style.borderColor = isError
      ? 'rgba(255,90,90,.75)'
      : sameBuild
        ? 'rgba(80,220,120,.65)'
        : currentBuild && siteBuild
          ? 'rgba(255,190,70,.7)'
          : 'rgba(255,255,255,.18)';

    const parts = [`Talents Forever RU v${VERSION}`];
    if (siteBuild) parts.push(`Site build: ${siteBuild}`);
    if (currentBuild) parts.push(`RU DB build: ${currentBuild}`);
    if (totalTalents) parts.push(`Matched talents: ${matchedTalents}/${totalTalents}`);
    parts.push('Нажмите, чтобы включить/выключить перевод');
    root.title = parts.join('\n');
  }

  async function init() {
    ensureStatus();
    updateStatus('RU · загрузка…');

    const classSlug = getClassSlug();
    if (!classSlug) {
      translateSubtree(document);
      observeDom();
      updateStatus('RU ON · интерфейс');
      return;
    }

    const className = CLASSES[classSlug];

    try {
      const [tfData, localData] = await Promise.all([
        requestJson(TF_DATA_URL),
        requestJson(`${RU_DATA_BASE}/${classSlug}.json`)
      ]);

      currentBuild = String(localData.build || '');
      siteBuild = extractSiteBuild(tfData, className);
      buildTalentTranslations(tfData, localData, className);

      translateSubtree(document);
      observeDom();
      updateStatus();

      if (siteBuild && currentBuild && siteBuild !== currentBuild) {
        console.warn(`[Talents Forever RU] Build mismatch: site=${siteBuild}, ruRU=${currentBuild}`);
      }
      console.info(
        `[Talents Forever RU] ${className}: matched ${matchedTalents}/${totalTalents} talents; site=${siteBuild || '?'} ruRU=${currentBuild || '?'}`
      );
    } catch (error) {
      console.error('[Talents Forever RU]', error);
      translateSubtree(document);
      observeDom();
      updateStatus('RU · ошибка DB', true);
    }
  }

  init();
})();
