// ==UserScript==
// @name        WaniKani SRS Counters
// @namespace   sonarius.wk
// @homepage    https://github.com/loksonarius/wanikani-userscripts/tree/main/wanikani-srs-counters
// @author      Sonarius
// @description Adds UI element to track review counts per SRS level.
// @version     1.0.1
// @grant       none
//
// @include     *://www.wanikani.com/review/session
//
// @updateURL   https://github.com/loksonarius/wanikani-userscripts/raw/main/wanikani-srs-counters/script.user.js
// @downloadURL https://github.com/loksonarius/wanikani-userscripts/raw/main/wanikani-srs-counters/script.user.js
// ==/UserScript==

/* Dependency Checking */
const wkof_version_needed = '1.0.51';
if (!window.wkof) {
  alert('[WaniKani SRS Counters] requires Wanikani Open Framework.\nYou will now be forwarded to installation instructions.');
  window.location.href = 'https://community.wanikani.com/t/instructions-installing-wanikani-open-framework/28549';
  return;
}

const wkof = window.wkof;
if (!wkof.version || wkof.version.compare_to(wkof_version_needed) === 'older') {
  alert('[WaniKani SRS Counters] requires Wanikani Open Framework version '+wkof_version_needed+'.\nYou will now be forwarded to update page.');
  window.location.href = 'https://greasyfork.org/en/scripts/38582-wanikani-open-framework';
  return;
}

/* Constants */
const $ = window.$;
const jstor = $.jStorage;
const wkcm_enabled = window.WaniKani.wanikani_compatibility_mode;
const script_settings_id = 'sonarius_wk_srscounters';
const counters_id = 'wk-srscounters-sort-counters';
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
  console.log(`[SRS Counters] ${s}`);
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
      alert(`[SRS Counters] Encountered error during operation: ${s}`);
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

function srs_stage_for(id) {
  const val = items_by_id[`${id}`];
  return !val ? -1 : val.assignments.srs_stage;
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
    title: 'SRS Counters',
    on_click: open_settings
  });
}

function load_settings() {
  log('loading settings...');
  const defaults = {
    show_srs_counters: true,
    highlight_current_level: false,
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

          display_page: {
            type: 'page',
            label: 'Display',
            content: {
              show_srs_counters: {
                type: 'checkbox',
                label: 'Display SRS counters ',
                hover_tip: 'Whether or not to display the SRS item counters.'
              },

              highlight_current_level: {
                type: 'checkbox',
                label: 'Highlight current SRS level ',
                hover_tip: 'Whether or not to highlight the current item\'s SRS level.'
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

  render_counters();

  log('settings saved!');
}

/* Counters */
function register_counters() {
  render_counters();
  jstor.listenKeyChange('currentItem', render_counters);
}

function render_counters() {
  const queue = get_queue();
  const items_per_srs = [0, 0, 0, 0, 0, 0, 0, 0];
  queue.forEach(function(i) {
    ++items_per_srs[srs_stage_for(i)-1];
  });

  const current_item = jstor.get('currentItem');
  const current_srs = current_item.srs;
  const settings = wkof.settings[script_settings_id];
  const $counters = $(`<div id="${counters_id}" style="background-color:rgba(255,255,255,0.9);border-radius:8px;color:black;font-weight:bold;margin-top:5px;text-shadow:none"></div>`);
  for (let srs = 1; srs <= items_per_srs.length; ++srs) {
    const color = srs < 5 ? 'DD0093' : srs < 7 ? '882D9E' : srs < 8 ? '294DDB' : '0093DD';
    if (srs > 1) {
      $counters.append(', ');
    }

    const text_style = (settings.highlight_current_level && srs == current_srs) ? ';text-decoration:underline' : '';
    $counters.append($('<span style="color:#' + color + ';margin:0' + text_style + '">' + items_per_srs[srs - 1] + '</span>'));
  }

  $counters.prop('hidden', !settings.show_srs_counters);
  $(`#${counters_id}`).remove();
  $('div#stats').append($counters);
}

/* Initialization */
wkof.include('Menu,Settings,ItemData');
wkof.ready('Menu,Settings,ItemData')
  .then(install_menu)
  .then(load_settings)
  .then(load_assignments, report_err('failed to load settings'))
  .then(cache_review_structs)
  .then(register_counters);
