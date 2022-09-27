// performance and correctness of code
'use strict';

// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-
/* exported Component */


// This is a handy import we'll use to grab our extension's object
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const {
    AccountsService, Clutter, GLib,
    GObject, Pango, Shell, St, Gio,
} = imports.gi;

const Dialog = imports.ui.dialog;
const Main = imports.ui.main;
const ModalDialog = imports.ui.modalDialog;
const ShellEntry = imports.ui.shellEntry;
const UserWidget = imports.ui.userWidget;
const Util = imports.misc.util;

const DELAYED_RESET_TIMEOUT = 200;

// Note that when using the D-Bus conveniences in GJS, our JavaScript
// implementation instance is separate from the GObject interface instance.
let serviceImplementation = null;
let serviceInterface = null;

let _realmName = "";

const ifaceXml = `
<node>
  <interface name="com.subgraph.realm_sudo_auth">
    <method name="TriggerUI">
      <arg type="s" direction="in" name="realmName"/>
      <arg type="b" direction="out" name="receiptOfMethod"/>
    </method>
    <signal name="GotResultFromUser">
      <arg name="realmName" type="s"/>
      <arg name="authorize_result" type="b"/>
    </signal>
  </interface>
</node>`;

class DBusService {
  TriggerUI(realmName) {
    log(`TriggerAndGetAuthResult() invoked with realm name: '${realmName}'`);

    _realmName = realmName;

    // triggers the UI to appear to user
    receivedAuthorizationRequest(realmName);

    return true;
  }
}

const RealmAuthorizationDialog = GObject.registerClass({
    Signals: {'done': {param_types: [GObject.TYPE_BOOLEAN]}},
}, class AuthorizationDialog extends ModalDialog.ModalDialog {
  _init(description, realmName) {
        super._init({styleClass: 'prompt-dialog'});

        this.message = description

        let title = _("Realm Authorization Required");

        let headerContent = new Dialog.MessageDialogContent({title, description});
        this.contentLayout.add_child(headerContent);

        let bodyContent = new Dialog.MessageDialogContent();

        let _ynBoxLayout = new St.BoxLayout({
            style_class: 'prompt-dialog-password-layout',
            vertical: true,
        });

        bodyContent.add_child(_ynBoxLayout);

        // if the user has selected never to use the password authentication to gran perm to realm
        this._noButton = this.addButton({
            label: _('No'),
            action: () => this._gotResultFromUI(realmName, false),
            key: Clutter.KEY_Escape,
        });

        this._yesButton = this.addButton({
            label: _('Yes'),
            action: () => this._gotResultFromUI(realmName, true),
            reactive: false,
        });

        this._yesButton.bind_property('reactive',
            this._yesButton, 'can-focus',
            GObject.BindingFlags.SYNC_CREATE);

        //this.contentLayout.add_child(bodyContent);

        this._doneEmitted = false;

        this._mode = -1;
    }

    // TODO: kinda ugly functions, let's find a way to pass function param in button action
    _gotResultFromUI(realmName, result) {
      serviceInterface.emit_signal('GotResultFromUser', new GLib.Variant('(sb)', [_realmName, result]));
      this.close();
    }

    _ensureOpen() {
      // NOTE: ModalDialog.open() is safe to call if the dialog is
      // already open - it just returns true without side-effects
      if (!this.open(global.get_current_time())) {
        this._emitDone(true);
      }
    }

    close(timestamp) {
      // Ensure cleanup if the dialog was never shown
      super.close(timestamp);
    }
});

function onBusAcquired(connection, name) {
  serviceImplementation = new DBusService();
  serviceInterface = Gio.DBusExportedObject.wrapJSObject(ifaceXml, serviceImplementation);
  serviceInterface.export(connection, '/com/subgraph/realm_sudo_auth');
}

function onNameAcquired(connection, name) {
    // Clients will typically start connecting and using your interface now.
}

function onNameLost(connection, name) {
    // Well behaved clients will know not to call methods on your interface now
}

function receivedAuthorizationRequest(realmName) {
  let description = "Realm " + realmName + " is requesting access";
  let realmAuthorizationDialog = new RealmAuthorizationDialog(description, realmName);

  realmAuthorizationDialog.open(global.get_current_time());
}

function init() {}

// called when extension started
function enable() {
    const ownerId = Gio.bus_own_name(
        Gio.BusType.SESSION,
        'com.subgraph.realm_sudo_auth',
        Gio.BusNameOwnerFlags.NONE,
        onBusAcquired.bind(serviceImplementation),
        onNameAcquired,
        onNameLost
    );
}

function disable() {
  log(`disabling ${Me.metadata.name} version ${Me.metadata.version}`);
}
