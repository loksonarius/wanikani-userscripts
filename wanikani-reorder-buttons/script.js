// ==UserScript==
// @name        WaniKani Reorder Buttons
// @namespace   sonarius.wk
// @homepage    https://github.com/loksonarius/wanikani-userscripts/tree/master/wanikani-reorder-buttons
// @author      Sonarius
// @description Adds button enabling item ordering by SRS level.
// @version     3.0.0
// @grant       none
//
// @include     *://www.wanikani.com/review/session
//
// @updateURL   https://github.com/loksonarius/wanikani-userscripts/raw/master/wanikani-reorder-buttons/script.user.js
// @downloadURL https://github.com/loksonarius/wanikani-userscripts/raw/master/wanikani-reorder-buttons/script.user.js
// ==/UserScript==

/* Dependency Checking */
const wkof_version_needed = '1.0.51';
if (!window.wkof) {
  alert('[WaniKani Reorder Buttons] requires Wanikani Open Framework.\nYou will now be forwarded to installation instructions.');
  window.location.href = 'https://community.wanikani.com/t/instructions-installing-wanikani-open-framework/28549';
  return;
}

const wkof = window.wkof;
if (!wkof.version || wkof.version.compare_to(wkof_version_needed) === 'older') {
  alert('[WaniKani Reorder Buttons] requires Wanikani Open Framework version '+wkof_version_needed+'.\nYou will now be forwarded to update page.');
  window.location.href = 'https://greasyfork.org/en/scripts/38582-wanikani-open-framework';
  return;
}

/* Constants */
const $ = window.$;
const jstor = $.jStorage;
const script_settings_id = 'sonarius_wk_reorderbuttons';

/* Util */
async function fetch_review_items(subject_ids) {
  // ideally, we'd only rely on documented endpoints, but there doesn't seem to
  // be any documented item in the API matching what's returned by this endpoint
  const subject_ids_str = subject_ids.join(',');
  return await fetch(`/review/items?ids=${subject_ids_str}`)
    .then(function(resp) {
      return resp.json();
    });
}

function log(s) {
  console.log(`[Reorder Buttons] ${s}`);
}

/* Lookup Data */
let items_by_id = {};
async function load_assignments() {
  log('prepping lookup data...');
  const config = { wk_items: { filters: { srs: {
    invert: true, value: 'lock, init, burn'
  }}}};

  await wkof.ItemData.get_items('assignments', config)
    .then(function(items) {
      items_by_id = wkof.ItemData.get_index(items, 'subject_id');
    });
}

/* Settings */
function install_menu() {
  log('installing menu...');
  wkof.Menu.insert_script_link({
    name: script_settings_id+'_settings',
    submenu: 'Settings',
    title: 'Reorder Buttons',
    on_click: open_settings
  });
  wkof.Menu.insert_script_link({
    name: script_settings_id+'_sort_asc',
    submenu: 'Sort Reviews',
    title: 'Ascending',
    on_click: function() { sort_queue(); }
  });
  wkof.Menu.insert_script_link({
    name: script_settings_id+'_sort_des',
    submenu: 'Sort Reviews',
    title: 'Descending',
    on_click: function() { sort_queue(false); }
  });
}

function load_settings() {
  log('loading settings...');
  const defaults = {
    sort_on_startup: false,
    item_type_order: 'rkv',
    prioritize_srs: true,
    force1x1: false,
    ascending_key: 'Equal',
    ascending_modifiers: {
      ctrl: false,
      alt: true,
      shift: true
    },
    descending_key: 'Minus',
    descending_modifiers: {
      ctrl: false,
      alt: true,
      shift: true
    },
  };
  return wkof.Settings.load(script_settings_id, defaults);
}

function open_settings() {
  const config = {
    script_id: script_settings_id,
    title: 'Settings',
    on_save: update_settings,
    content: {
      sorting_group: {
        type: 'group',
        label: 'Sorting Behavior',
        content: {
          sort_on_startup: {
            type: 'checkbox',
            label: 'Sort on Startup',
            hover_tip: 'Enables auto-sorting of reviews upon loading.'
          },
          item_type_order: {
            type: 'dropdown',
            label: 'Item-Type Ordering',
            hover_tip: 'Determines ordering between radicals, kanji, and vocabulary.',
            content: {
              rkv: "Radical -> Kanji -> Vocabulary",
              vkr: "Vocabulary -> Kanji -> Radical",
              ran: "Random"
            }
          },
          prioritize_srs: {
            type: 'checkbox',
            label: 'Prioritize SRS',
            hover_tip: 'Sort by SRS level before sorting by item type.'
          },
          force1x1: {
            type: 'checkbox',
            label: 'Force 1x1',
            hover_tip: 'Force meaning and reading questions to be in succession.'
          },
        }
      },
      keycombo_group: {
        type: 'group',
        label: 'Hotkeys',
        content: {
          ascending_group: {
            type: 'group',
            label: 'Ascending Sort Hotkeys',
            content: {
              ascending_key: {
                type: 'text',
                label: 'Activation Key Event Code',
                hover_tip: 'Press this key to sort reviews in ascending order.'
              },
              ascending_helptext: {
                type: 'html',
                label: 'Note',
                html: '<i>Use <a href="https://keycode.info" target="_blank">this site</a> to get the <em>event.code</em> for your desired binding</i>',
              },
              ascending_modifiers: {
                type: 'list',
                label: 'Modifier Keys',
                hover_tip: 'Modifier keys that must be pressed along activation key.',
                multi: true,
                content: {
                  ctrl: "Control",
                  alt: "Alt",
                  shift: "Shift",
                }
              },
            }
          },
          descending_group: {
            type: 'group',
            label: 'Descending Sort Hotkey',
            content: {
              descending_key: {
                type: 'text',
                label: 'Activation Key Event Code',
                hover_tip: 'Press this key to sort reviews in descending order.'
              },
              descending_helptext: {
                type: 'html',
                label: 'Note',
                html: '<i>Use <a href="https://keycode.info" target="_blank">this site</a> to get the <em>event.code</em> for your desired binding</i>',
              },
              descending_modifiers: {
                type: 'list',
                label: 'Modifier Keys',
                hover_tip: 'Modifier keys that must be pressed along activation key.',
                multi: true,
                content: {
                  ctrl: "Control",
                  alt: "Alt",
                  shift: "Shift",
                }
              },
            }
          }
        }
      }
    }
  };
  const dialog = new wkof.Settings(config);
  dialog.open();
}

function update_settings() {
  log('settings saved!');
}

/* Hotkeys */
function register_hotkeys() {
  document.addEventListener('keydown', function(e) {
    if (event.defaultPrevented) {
      return;
    }

    const settings = wkof.settings[script_settings_id];
    const asc_key = settings.ascending_key;
    const asc_mod = settings.ascending_modifiers;
    const des_key = settings.descending_key;
    const des_mod = settings.descending_modifiers;

    switch (e.code) {
      case asc_key:
        if (e.shiftKey == asc_mod.shift &&
          e.altKey == asc_mod.alt &&
          e.ctrlKey == asc_mod.ctrl) {
          e.preventDefault();
          sort_queue();
        }
        break;
      case des_key:
        if (e.shiftKey == des_mod.shift &&
          e.altKey == des_mod.alt &&
          e.ctrlKey == des_mod.ctrl) {
          e.preventDefault();
          sort_queue(false);
        }
        break;
      default:
        return;
    }
  });
}

/* Sorting */
function type_priority_of(id) {
  const val = items_by_id[`${id}`];
  if (!val) {
    return -1;
  }

  switch (val.assignments.subject_type) {
    case 'radical':
      return 1;
    case 'kanji':
      return 2;
    case 'vocabulary':
      return 3;
  }

  return -1;
}

function srs_stage_for(id) {
  const val = items_by_id[`${id}`];
  return !val ? -1 : val.assignments.srs_stage;
}

function make_comparator(ascending=true) {
  const srs = function(a,b) {
    const res = srs_stage_for(a) - srs_stage_for(b);
    if (!ascending) {
      return -res;
    }

    return res;
  };

  const settings = wkof.settings[script_settings_id];
  const type_order = settings.item_type_order;
  const type = function(a,b) {
    const res = type_priority_of(a) - type_priority_of(b);
    switch (type_order) {
      case 'rkv':
        return res;
      case 'vkr':
        return -res;
      default:
        return 0;
    }
  };

  if (settings.prioritize_srs) {
    return function(a,b) { return srs(a,b) || type(a,b); };
  }

  return function(a,b) { return type(a,b) || srs(a,b); };
}

async function sort_queue(ascending=true) {
  log('sorting queue...');
  const queue = jstor.get('activeQueue')
    .map(i => i.id)
    .concat(jstor.get('reviewQueue'));

  queue.sort(make_comparator(ascending));

  const active_queue_items = await fetch_review_items(queue.slice(0,10));
  const active_queue = queue.slice(0,10).map(x => active_queue_items.find(i => i.id == x));
  jstor.set('activeQueue', active_queue);
  jstor.set('reviewQueue', queue.slice(10).reverse());
  jstor.set('currentItem', active_queue[0]);

  // this was inherited from previous script version -- no clue how nor why it
  // works, but I did miss not having it around, so I'm bringing it back as an
  // opt-in option
  if (wkof.settings[script_settings_id].force1x1) {
    try {
      unsafeWindow.Math.random = function() { return 0; };
    } catch (e) {
      Math.random = function() { return 0; };
    }
  }
}

/* Counters */
function register_counters() {
  show_counters();
  jstor.listenKeyChange('currentItem', show_counters);
}

function show_counters() {
  const queue = jstor.get('activeQueue')
    .map(i => i.id)
    .concat(jstor.get('reviewQueue'));

  const items_per_srs = [0, 0, 0, 0, 0, 0, 0, 0];
  queue.forEach(function(i) {
    ++items_per_srs[srs_stage_for(i)-1];
  });

  const $counters = $('<div id="srs-counters" style="background-color:rgba(255,255,255,0.9);border-radius:8px;color:black;font-weight:bold;margin-top:5px;text-shadow:none"></div>');
  for (let srs = 1; srs <= items_per_srs.length; ++srs) {
    const color = srs < 5 ? 'DD0093' : srs < 7 ? '882D9E' : srs < 8 ? '294DDB' : '0093DD';
    if (srs > 1) {
      $counters.append(', ');
    }
    $counters.append($('<span style="color:#' + color + ';margin:0">' + items_per_srs[srs - 1] + '</span>'));
  }
  $('#srs-counters').remove();
  $('div#stats').append($counters);
}

/* Initialization */
wkof.include('Menu,Settings,ItemData');
wkof.ready('Menu,Settings,ItemData')
  .then(install_menu)
  .then(load_settings)
  .then(load_assignments)
  .then(register_hotkeys)
  .then(register_counters)
  .then(startup);

function startup() {
  if (wkof.settings[script_settings_id].sort_on_startup) {
    sort_queue();
  }
  log('ready!');
}
