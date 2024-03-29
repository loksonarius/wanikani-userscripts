// ==UserScript==
// @name        WaniKani Reorder Buttons
// @namespace   sonarius.wk
// @homepage    https://github.com/loksonarius/wanikani-userscripts/tree/main/wanikani-reorder-buttons
// @author      Sonarius
// @description Adds button enabling item ordering by SRS level.
// @version     3.4.0
// @grant       none
//
// @include     *://www.wanikani.com/review/session
//
// @updateURL   https://github.com/loksonarius/wanikani-userscripts/raw/main/wanikani-reorder-buttons/script.user.js
// @downloadURL https://github.com/loksonarius/wanikani-userscripts/raw/main/wanikani-reorder-buttons/script.user.js
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

/* State */
var current_sorting = 'random';

/* Constants */
const $ = window.$;
const jstor = $.jStorage;
// these options enable compatibility with other userscripts like Back2Back
const jstorage_options = {b2b_ignore: true};
const wkcm_enabled = window.WaniKani.wanikani_compatibility_mode;
const script_settings_id = 'sonarius_wk_reorderbuttons';
const button_id = 'wk-reorderbuttons-sort-btn';
const icon_id = 'wk-reorderbuttons-sort-icon';
const logs = [];

/* Util */
function prompt_download(name, content) {
  const bb = new Blob(content, { type: 'text/plain' });
  const a = document.createElement('a');
  a.download = name;
  a.href = window.URL.createObjectURL(bb);
  a.textContent = 'Download ready';
  a.style='display:none';
  a.click();
  a.remove();
}

function log(s) {
  const time = new Date(Date.now());
  logs.push(`[${time}] ${s}\n`);
  console.log(`[Reorder Buttons] ${s}`);
}

function report_err(s) {
  return function(err) {
    // save to javascript logs for detailed user error-reporting
    log(s);
    log(`error: ${err}`);
    // alert on error if configured to do so
    const settings = wkof.settings[script_settings_id];
    const alert_on_error = settings.alert_on_error;
    if (alert_on_error) {
      alert(`[Reorder Buttons] Encountered error during operation: ${s}`);
    }
  };
}

async function fetch_review_items(subject_ids) {
  // ideally, we'd only rely on documented endpoints, but there doesn't seem to
  // be any documented item in the API matching what's returned by this endpoint
  const subject_ids_str = subject_ids.join(',');
  return await fetch(`/review/items?ids=${subject_ids_str}`)
    .then(function(resp) {
      return resp.json();
    }, report_err('failed to fetch review items'));
}

function get_queue() {
  return jstor.get('activeQueue')
    .map(i => i.id)
    // if we're in compatibility mode, we'll need to rip out ids
    .concat(jstor.get('reviewQueue').map(i => wkcm_enabled ? i.id : i));
}

/* Lookup Data */
var items_by_id = {};
async function load_assignments() {
  log('prepping lookup data...');
  const config = { wk_items: { filters: { srs: {
    invert: true, value: 'lock, init, burn'
  }}}};

  await wkof.ItemData.get_items('assignments', config)
    .then(function(items) {
      items_by_id = wkof.ItemData.get_index(items, 'subject_id');
    }, report_err('failed to fetch assignments'));
}

var review_structs = [];
async function cache_review_structs() {
  // this should only ever run if we're in compatibility mode -- the data cached
  // by this isn't meant to stick around going forward
  if (!wkcm_enabled) {
    log('not caching review item data due to disabled compatibility mode...');
    return;
  }

  log('caching review item data...');
  // this isn't really meant for permanent use, but it'll be the easiest way of
  // getting full review item structs in one go
  await fetch('/review/queue')
    .then(function(resp) {
      resp.json().then(
        function(data) {
          review_structs = data;
        }, report_err('failed to parse review queue data'));
    }, report_err('failed to fetch review queue data'));
  log('review item data cached!');
}

/* Settings */
function install_menu() {
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
  wkof.Menu.insert_script_link({
    name: script_settings_id+'_randomize',
    submenu: 'Sort Reviews',
    title: 'Random',
    on_click: function() { randomize_queue(); }
  });
}

function load_settings() {
  log('loading settings...');
  const defaults = {
    startup_sort_order: 'none',
    item_type_order: 'rkv',
    prioritize_srs: true,
    question_type_order: 'random',
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
    show_sort_button: true,
    alert_on_error: false,
  };
  log('settings loaded!');
  return wkof.Settings.load(script_settings_id, defaults);
}

function open_settings() {
  log('opening settings panel...');
  const config = {
    script_id: script_settings_id,
    title: 'Settings',
    on_save: update_settings,
    content: {
      tabset:{
        type: 'tabset',
        content: {

          sorting_page: {
            type: 'page',
            label: 'Sorting',
            content: {
              startup_section: {
                type: 'section',
                label: 'Startup'
              },
              startup_sort_order: {
                type: 'dropdown',
                label: 'Startup Sort Ordering to Use',
                hover_tip: 'Determines order to use on during startup sort. None disables startup sort entirely.',
                content: {
                  none: 'None',
                  ascending: 'Ascending',
                  descending: 'Descending'
                }
              },

              general_section: {
                type: 'section',
                label: 'General'
              },
              item_type_order: {
                type: 'dropdown',
                label: 'Item-Type Ordering',
                hover_tip: 'Determines ordering between radicals, kanji, and vocabulary.',
                content: {
                  rkv: 'Radical -> Kanji -> Vocabulary',
                  vkr: 'Vocabulary -> Kanji -> Radical',
                  ran: 'Random'
                }
              },
              question_type_order: {
                type: 'dropdown',
                label: 'Question-Type Ordering',
                hover_tip: 'Determines whether readings, meanings, or any will be asked first.',
                content: {
                  reading: 'Reading -> Meaning',
                  meaning: 'Meaning -> Reading',
                  random: 'Random'
                }
              },
              prioritize_srs: {
                type: 'checkbox',
                label: 'Prioritize SRS',
                hover_tip: 'Sort by SRS level before sorting by item type.'
              }
            }
          },

          hotkey_page: {
            type: 'page',
            label: 'HotKeys',
            content: {
              ascending_section: {
                type: 'section',
                label: 'Sort Ascending',
              },
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
                  ctrl: 'Control',
                  alt: 'Alt',
                  shift: 'Shift',
                }
              },

              descending_section: {
                type: 'section',
                label: 'Sort Descending',
              },
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
                  ctrl: 'Control',
                  alt: 'Alt',
                  shift: 'Shift',
                }
              },
            }
          },

          display_page: {
            type: 'page',
            label: 'Display',
            content: {
              show_sort_button: {
                type: 'checkbox',
                label: 'Display sort button ',
                hover_tip: 'Whether or not to display the SRS sort button.'
              }
            }
          },

          debug_page: {
            type: 'page',
            label: 'Help',
            content: {
              contact_section: {
                type: 'section',
                label: 'Contact Us'
              },
              contact_html: {
                type: 'html',
                html: '<p>If you\'d like to contact us regarding feature requests or questions, please try any of the following:</p><ul><li><a href="https://community.wanikani.com/t/userscript-reorder-buttons/41133">WaniKani Community Forum thread for this plugin</a></li><li><a href="https://github.com/loksonarius/wanikani-userscripts">Our GitHub repo</a></li></ul>'
              },

              bugs_section: {
                type: 'section',
                label: 'Reporting Bugs'
              },
              bugs_html: {
                type: 'html',
                html: '<p>If you intend on reporting a bug or some unexpected behavior, please help us by referencing <a href="https://github.com/loksonarius/wanikani-userscripts/blob/main/BUGS.md">bug report guide</a>. It will contain some basic diagnostic steps and questions we will need answers to before helping!</p>'
              },

              debug_section: {
                type: 'section',
                label: 'Debug'
              },
              alert_on_error: {
                type: 'checkbox',
                label: 'Alert on Error',
                hover_tip: 'Enables browser alerts whenever an error is detected.'
              },
              download_logs: {
                type: 'button',
                label: 'Save extension logs to file',
                text: 'Download Logs',
                hover_tip: 'Downloads all local logs for this script to a local file.',
                on_click: function(name, config, on_change) {
                  prompt_download(`${script_settings_id}.log`, logs);
                }
              }

            }
          }

        }
      },
    }
  };
  const dialog = new wkof.Settings(config);
  dialog.open();
  log('settings panel opened!');
}

function update_settings() {
  log('saving new settings...');

  update_sort_button();

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

/* Item Sorting */
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

function sort_queue(ascending=true) {
  log('sorting queue...');

  if (ascending) {
    current_sorting = 'ascending';
  } else {
    current_sorting = 'descending';
  }
  update_sort_button();

  const queue = get_queue();
  queue.sort(make_comparator(ascending));
  set_reviews(queue);
  log(`sorted queues in ${current_sorting} order!`);
}

function randomize_queue() {
  log('shuffling queue...');

  current_sorting = 'random';
  update_sort_button();

  const shuffled = get_queue()
    .map((value) => ({ value, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ value }) => value)
  set_reviews(shuffled);
  log('shuffled queues!');
}

async function set_reviews(queue) {
  log('setting review and active queues...');

  const active_queue_items = await fetch_review_items(queue.slice(0,10));
  const active_queue = queue.slice(0,10).map(x => active_queue_items.find(i => i.id == x));
  jstor.set('activeQueue', active_queue, jstorage_options);

  const review_queue = queue.slice(10).map(x => wkcm_enabled ? review_structs.find(i => i.id == x) : x);
  jstor.set('reviewQueue', review_queue, jstorage_options);

  jstor.set('currentItem', active_queue[0], jstorage_options);
  log('set queues!');
}

/* Type Sorting */
function register_type_sorter() {
  const wrapping_func = function(key, action) {
    jstor.stopListening('currentItem', wrapping_func);
    order_question_type();
    jstor.listenKeyChange('currentItem', wrapping_func);
  };

  jstor.listenKeyChange('currentItem', wrapping_func);
}

function order_question_type() {
  const current_item = jstor.get('currentItem');
  if (current_item.type == 'Radical') {
    log('radical item encountered, correcting sort question type...');
    // there's nothing to really try sorting for radicals, though we should
    // ensure the question type is at least accurate for them
    jstor.set('questionType', 'meaning', jstorage_options)
    jstor.set('currentItem', current_item, jstorage_options)
    return;
  }

  const settings = wkof.settings[script_settings_id];
  const requested_order = settings.question_type_order;
  if (requested_order == 'random') {
    // nothing to worry about here
    log('random question type order requested, skipping...');
    return;
  }

  const item_type = current_item.type == 'Kanji' ? 'k' : 'v';
  const uid = item_type + current_item.id;
  const data = jstor.get(uid);
  if (data && (data.rc || data.mc)) {
    log('previous question answer given, refusing to reorder question type...');
    // there is some record of this being answered correctly previously so we
    // really just want to let WK have the user answer the second question type
    return;
  }

  // code below this point assumes there's either no data, or only data
  // indicating wrong answers, so we'll force some question type as requested
  switch (requested_order) {
    case 'reading':
    case 'meaning':
      const current_type = jstor.get('questionType');
      if (current_type != requested_order) {
        log('reordering question type...');

        jstor.set('questionType', requested_order, jstorage_options)
        jstor.set('currentItem', current_item, jstorage_options)
      } else {
        log('question type already matches requested order, skipping...');
      }
      break;
    case 'random':
      // shouldn't hit this case
      break;
    default:
      log(`invalid question type order set: ${requested_order}`);
      log('user should try updating their preferences in the settings panel');
  }
}

/* Sort Button */
function update_sort_button() {
  const icon = $(`#${icon_id}`)
  switch (current_sorting) {
    case 'random':
      icon.addClass('fa-sort');
      icon.removeClass('fa-sort-asc');
      icon.removeClass('fa-sort-desc');
      break;
    case 'ascending':
      icon.removeClass('fa-sort');
      icon.addClass('fa-sort-asc');
      icon.removeClass('fa-sort-desc');
      break;
    case 'descending':
      icon.removeClass('fa-sort');
      icon.removeClass('fa-sort-asc');
      icon.addClass('fa-sort-desc');
      break;
    default:
      log('unknown sorting order to use -- defaulting to ascending...');
      icon.addClass('fa-sort');
      icon.removeClass('fa-sort-asc');
      icon.removeClass('fa-sort-desc');
  }

  const settings = wkof.settings[script_settings_id];
  $(`#${button_id}`).prop('hidden', !settings.show_sort_button);
}

function sort_clicked() {
  switch (current_sorting) {
    case 'random':
      sort_queue();
      break;
    case 'ascending':
      sort_queue(false);
      break;
    case 'descending':
      randomize_queue();
      break;
    default:
      log('unknown sorting order to use -- defaulting to ascending...');
      sort_queue();
      return;
  }
}

function register_sort_button() {
  $('#summary-button').append(`<a id="${button_id}" href="#" hidden ><i id="${icon_id}" class="fa fa-sort" title="SRS Level Sort - reorder the current review sorting by SRS level."></i></a>`);
  $(`#${button_id}`).on('click', sort_clicked);
  update_sort_button();
}

/* Initialization */
wkof.include('Menu,Settings,ItemData');
wkof.ready('Menu,Settings,ItemData')
  .then(install_menu)
  .then(load_settings)
  .then(load_assignments, report_err('failed to load settings'))
  .then(cache_review_structs)
  .then(register_hotkeys)
  .then(register_sort_button)
  .then(register_type_sorter)
  .then(startup);

function startup() {
  log('running startup...');
  const settings = wkof.settings[script_settings_id];
  switch (settings.startup_sort_order) {
    case 'ascending':
      sort_queue();
      break;
    case 'descending':
      sort_queue(false);
      break;
    case 'none':
      // no-op
      break;
    default:
      log(`invalid startup sort order set: ${settings.startup_sort_order}`);
      break;
  }

  log('startup completed!');
}
