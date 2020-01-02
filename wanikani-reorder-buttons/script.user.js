// ==UserScript==
// @name        WaniKani Reorder Buttons
// @namespace   sonarius.wk
// @author      Sonarius
// @description Adds button enabling item ordering by SRS level.
// @version     1.0.0
// @grant       none
//
// @include     *://www.wanikani.com/review/session
//
// @updateURL   https://github.com/loksonarius/wanikani-userscripts/raw/master/wanikani-reorder-buttons/script.user.js
// @downloadURL https://github.com/loksonarius/wanikani-userscripts/raw/master/wanikani-reorder-buttons/script.user.js
// ==/UserScript==

/* Settings */

const questionTypeOrder = 1; // 1 - reading first, 2 - meaning first, 3 - random
const itemTypeOrder = 1;     // 1 - rad->kan->voc, 2 - voc->kan->rad, 3 - random
const ascendingSRS = true;   // low-level items first
const priotitizeSRS = true;  // SRS order more important than item type order
const force1x1 = true;       // meaning and reading directly next to each other
const sortOnStartup = true;  // sort items on startup
const ascHotKey = 'Equal'    // keyboard shortcut (key code)
const desHotKey = 'Minus'    // keyboard shortcut (key code)

/* Utilities */

const $ = window.$;

function getTypePriority(item) {
  if (item.rad) {
    return 1;
  } else if (item.kan) {
    return 2;
  } else {
    return 3;
  }
}

function ascComparator(itemA, itemB) {
  const srsOrder = ascendingSRS ? itemA.srs - itemB.srs : itemB.srs - itemA.srs;
  const typeOrder = itemTypeOrder === 3 ? 0 : (getTypePriority(itemA) - getTypePriority(itemB)) * (3 - itemTypeOrder * 2);
  return priotitizeSRS ? srsOrder || typeOrder : typeOrder || srsOrder;
}

function desComparator(itemA, itemB) {
  const srsOrder = ascendingSRS ? itemB.srs - itemA.srs : itemA.srs - itemB.srs;
  const typeOrder = itemTypeOrder === 3 ? 0 : (getTypePriority(itemA) - getTypePriority(itemB)) * (3 - itemTypeOrder * 2);
  return priotitizeSRS ? srsOrder || typeOrder : typeOrder || srsOrder;
}

function showCounters(items) {
  const itemsByLevels = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < items.length; ++i) {
    ++itemsByLevels[items[i].srs - 1];
  }
  const $srsCounters = $('<div id="srsCounters" style="background-color:rgba(255,255,255,0.9);border-radius:8px;color:black;font-weight:bold;margin-top:5px;text-shadow:none"></div>');
  for (let level = 1; level <= itemsByLevels.length; ++level) {
    const color = level < 5 ? 'DD0093' : level < 7 ? '882D9E' : level < 8 ? '294DDB' : '0093DD';
    if (level > 1) {
      $srsCounters.append(', ');
    }
    $srsCounters.append($('<span style="color:#' + color + ';margin:0">' + itemsByLevels[level - 1] + '</span>'));
  }
  $('#srsCounters').remove();
  $('div#stats').append($srsCounters);
}

/* Event handlers */

const usedUIDs = [];

function reorderQuestionTypes() {
  const item = $.jStorage.get('currentItem');
  const newUID = (item.rad ? 'r' : item.kan ? 'k' : 'v') + item.id;
  if (usedUIDs.includes(newUID)) {
    return;
  }
  usedUIDs.push(newUID);
  const requestedType = ['reading', 'meaning'][item.rad ? 1 : questionTypeOrder - 1];
  if ($.jStorage.get("questionType") !== requestedType) {
    $.jStorage.set('questionType', requestedType);
    $.jStorage.set('currentItem', item);
  }
}

function updateCounters() {
  const items = $.jStorage.get('activeQueue').concat($.jStorage.get('reviewQueue'));
  showCounters(items);
  return items;
}

function reorderBySrs(ascending = true) {
  const items = updateCounters();
  if (ascending) {
      items.sort(ascComparator);
  } else {
      items.sort(desComparator);
  }

  $.jStorage.set('activeQueue', items.slice(0, 10));
  $.jStorage.set('reviewQueue', items.slice(10).reverse());
  if (questionTypeOrder !== 3) {
    $.jStorage.listenKeyChange('currentItem', reorderQuestionTypes);
  }
  $.jStorage.listenKeyChange('currentItem', updateCounters);
  $.jStorage.set('currentItem', items[0]);

  if (force1x1) {
    try {
      unsafeWindow.Math.random = function() { return 0; };
    } catch (e) {
      Math.random = function() { return 0; };
    }
  }
}

/* Initialization */

$(function() {
  const $spacer = $('<div style="background-color: #FFFFFF; color: #FFFFFF; cursor: pointer; display: inline-block; font-size: 0.8125em; padding: 2px; vertical-align: bottom;"/>');
  const $ascButton = $('<div style="background-color: #A000f0; outline: 2px solid white; color: #FFFFFF; cursor: pointer; display: inline-block; font-size: 0.8125em; padding: 10px; vertical-align: bottom;">SRS Sort ↑</div>');
  const $desButton = $('<div style="background-color: #A000f0; outline: 2px solid white; color: #FFFFFF; cursor: pointer; display: inline-block; font-size: 0.8125em; padding: 10px; vertical-align: bottom;">SRS Sort ↓</div>');

  $('footer').prepend($spacer);
  $('footer').prepend($desButton.click(function() { reorderBySrs(false); }));
  $('footer').prepend($ascButton.click(function() { reorderBySrs(true); }));

  document.addEventListener('keydown', function(e) {
    if (e.shiftKey && e.altKey && e.code == ascHotKey) {
      reorderBySrs(true);
      e.preventDefault();
    } else if (e.shiftKey && e.altKey && e.code == desHotKey) {
      reorderBySrs(false);
      e.preventDefault();
    }
  });

  if (sortOnStartup) {
    const observer = new MutationObserver(function() {
      reorderBySrs(true);
      observer.disconnect();
    });
    observer.observe(document.getElementById('loading'), { attributes: true });
  }
});
// ==/UserScript==
