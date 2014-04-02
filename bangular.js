(function(root, Backbone, _) {
  "use strict";

  // What is Bangular?
  // ---
  // Bangular is an extension to Backbone.
  // Bangular adds the following things to Backbone:
  // - View, Region, and Subview management (inspired by marionette.js)
  // - Model-View bindings (inspired by knockout.js)
  // - Model relations
  // - Model computed properties
  // - A better Router that aborts XHR requests when navigating

  // Define and export the Bangular namespace
  var Bangular = root.Bangular = {};
  Backbone.Bangular = Bangular;

  // Version string
  Bangular.VERSION = '0.2.0';

  // Debug flag
  Bangular.DEBUG = false;

  // Get the DOM manipulator for later use
  Bangular.$ = Backbone.$;

  // jQuery extensions
  // ---

  // Helper for inserting a child element at a specific index
  jQuery.fn.insertAt = function(index, element) {
    var lastIndex = this.children()
      .size();
    if (index < 0) {
      index = Math.max(0, lastIndex + 1 + index);
    }
    this.append(element);
    if (index < lastIndex) {
      this.children()
        .eq(index)
        .before(this.children()
          .last());
    }
    return this;
  };

  // jQuery "splendid textinput" plugin
  // http://benalpert.com/2013/06/18/a-near-perfect-oninput-shim-for-ie-8-and-9.html
  // https://github.com/pandell/jquery-splendid-textchange
  (function initSplendidTextChange($) {
    // Determine if this is a modern browser (i.e. not IE 9 or older);
    // if it is, the "input" event is exactly what we want so simply
    // mirror it as "textchange" event
    var testNode = document.createElement("input");
    var isInputSupported = (testNode.oninput !== undefined &&
      ((document.documentMode || 100) > 9));
    if (isInputSupported) {
      $(document)
        .on("input", function mirrorInputEvent(e) {
          $(e.target)
            .trigger("textchange");
        });

      return;
    }


    // ********* OLD IE (9 and older) *********

    var queueEventTargetForNotification = null;
    var activeElement = null;
    var notificationQueue = [];
    var watchedEvents = "keyup keydown";

    // 90% of the time, keydown and keyup aren't necessary. IE 8 fails
    // to fire propertychange on the first input event after setting
    // `value` from a script and fires only keydown, keypress, keyup.
    // Catching keyup usually gets it and catching keydown lets us fire
    // an event for the first keystroke if user does a key repeat
    // (it'll be a little delayed: right before the second keystroke).


    // Return true if the specified element can generate
    // change notifications (i.e. can be used by users to input values).
    function hasInputCapabilities(elem) {
      // The HTML5 spec lists many more types than `text` and `password` on
      // which the input event is triggered but none of them exist in IE 8 or
      // 9, so we don't check them here
      return (
        (elem.nodeName === "INPUT" &&
          (elem.type === "text" || elem.type === "password")) ||
        elem.nodeName === "TEXTAREA"
      );
    }


    // Update the specified target so that we can track its value changes.
    // Returns true if extensions were successfully installed, false otherwise.
    function installValueExtensionsOn(target) {
      if (target.valueExtensions) {
        return true;
      }
      if (!hasInputCapabilities(target)) {
        return false;
      }

      // add extensions container
      // not setting "current" initially (to "target.value") allows 
      // drag & drop operations (from outside the control) to send change notifications
      target.valueExtensions = {
        current: null
      };

      // attempt to override "target.value" property
      // so that it prevents "propertychange" event from firing
      // (for consistency with "input" event behaviour)
      if (target.constructor && target.constructor.prototype) { // target.constructor is undefined in quirks mode
        var descriptor = Object.getOwnPropertyDescriptor(target.constructor.prototype, "value");
        Object.defineProperty(target, "value", { // override once, never delete
          get: function() {
            return descriptor.get.call(this);
          },
          set: function(val) {
            target.valueExtensions.current = val;
            descriptor.set.call(this, val);
          }
        });
      }

      // subscribe once, never unsubcribe
      $(target)
        .on("propertychange", queueEventTargetForNotification)
        .on("dragend", function onSplendidDragend(e) {
          window.setTimeout(function onSplendidDragendDelayed() {
            queueEventTargetForNotification(e);
          }, 0);
        });

      return true;
    }


    // Fire "textchange" event for each queued element whose value changed.
    function processNotificationQueue() {
      // remember the current notification queue (for processing)
      // + create a new queue so that if "textchange" event handlers
      // cause new notification requests to be queued, they will be
      // added to the new queue and handled in the next tick
      var q = notificationQueue;
      notificationQueue = [];

      var target, targetValue, i, l;
      for (i = 0, l = q.length; i < l; i += 1) {
        target = q[i];
        targetValue = target.value;
        if (target.valueExtensions.current !== targetValue) {
          target.valueExtensions.current = targetValue;
          $(target)
            .trigger("textchange");
        }
      }
    }


    // If target element of the specified event has not yet been
    // queued for notification, queue it now.
    queueEventTargetForNotification = function queueEventTargetForNotification(e) {
      var target = e.target;
      if (installValueExtensionsOn(target) && target.valueExtensions.current !== target.value) {
        var i, l;
        for (i = 0, l = notificationQueue.length; i < l; i += 1) {
          if (notificationQueue[i] === target) {
            break;
          }
        }
        if (i >= l) { // "target" is not yet queued
          notificationQueue.push(target);

          if (l === 0) { // we just queued the first item, schedule processor in the next tick
            window.setTimeout(processNotificationQueue, 0);
          }
        }
      }
    };


    // Mark the specified target element as "active" and add event listeners to it.
    function startWatching(target) {
      activeElement = target;
      $(activeElement)
        .on(watchedEvents, queueEventTargetForNotification);
    }


    // Remove the event listeners from the "active" element and set "active" to null.
    function stopWatching() {
      if (activeElement) {
        $(activeElement)
          .off(watchedEvents, queueEventTargetForNotification);
        activeElement = null;
      }
    }


    // In IE 8, we can capture almost all .value changes by adding a
    // propertychange handler (in "installValueExtensionsOn").
    //
    // In IE 9, propertychange/input fires for most input events but is buggy
    // and doesn't fire when text is deleted, but conveniently,
    // "selectionchange" appears to fire in all of the remaining cases so
    // we catch those.
    //
    // In either case, we don't want to call the event handler if the
    // value is changed from JS so we redefine a setter for `.value`
    // that allows us to ignore those changes (in "installValueExtensionsOn").
    $(document)
      .on("focusin", function onSplendidFocusin(e) {
        // stopWatching() should be a noop here but we call it just in
        // case we missed a blur event somehow.
        stopWatching();

        if (installValueExtensionsOn(e.target)) {
          startWatching(e.target);
        }
      })

    .on("focusout", stopWatching)

    .on("input", queueEventTargetForNotification)

    .on("selectionchange", function onSplendidSelectionChange(e) {
      // IE sets "e.target" to "document" in "onselectionchange"
      // event (not very useful); use document.selection instead
      // to determine actual target element
      if (document.selection) {
        var r = document.selection.createRange();
        if (r) {
          var p = r.parentElement();
          if (p) {
            e.target = p;
            queueEventTargetForNotification(e);
          }
        }
      }
    });

  }(jQuery));



  // Javascript extensions
  // ---

  // Moves an array element from one index to another
  Array.prototype.move = function(from, to) {
    this.splice(to, 0, this.splice(from, 1)[0]);
  };



  // Bangular methods
  // ---

  // Log helper
  Bangular.log = function() {
    if (!Bangular.DEBUG || !console) {
      return;
    }

    console.log.apply(console, arguments);
  };

  // Error Helper
  Bangular.throwError = function(message, name) {
    var error = new Error(message);
    error.name = name || 'Error';
    throw error;
  };

  // Centralized XHR pool
  // Allows automatic aborting of pending XHRs when navigate is called
  Bangular.xhrs = [];
  Bangular.addXhr = function(xhr) {
    // Invalid xhr (or false)
    // Backbone sync will may return false
    if (!xhr) {
      return;
    }
    Bangular.xhrs.push(xhr);

    xhr.always(function() {
      var index = _.indexOf(Bangular.xhrs, this);
      if (index >= 0) {
        Bangular.xhrs.splice(index, 1);
      }
    }.bind(xhr));
  };

  // Bangular.Router
  // ---
  // Extends Backbone.Router
  Bangular.Router = Backbone.Router.extend({
    navigate: function(route, options) {
      options = options || {};

      // Don't navigate if route didn't change
      if (Backbone.history.fragment === route) {
        return this;
      }

      // Determine whether we should navigate
      if (!this.shouldNavigate(options)) {
        return this;
      }

      // This aborts all pending XHRs when Backbone tries to navigate
      _.each(Bangular.xhrs, function(xhr) {
        if (xhr.readyState && xhr.readyState > 0 && xhr.readyState < 4) {
          Bangular.log('XHR aborted due to router navigation');
          xhr.abort();
        }
      });
      Bangular.xhrs = [];
      if (options.force) {
        Backbone.history.fragment = null;
      }
      Backbone.history.navigate(route, options);
    },

    shouldNavigate: function(options) {
      return true;
    },
  });



  // Computed Properties
  Function.prototype.property = function() {
    var args = Array.prototype.slice.call(arguments);
    this.properties = args;
    return this;
  };


  // Bangular.Model
  // ---
  // Extends Backbone.DeepModel and adds support for: 
  // Backbone.Model.oldset = Backbone.Model.prototype.set;
  // 
  // - relations
  // - computed properties
  Bangular.Model = Backbone.DeepModel.extend({
    // Override set to support relations and computed properties
    set: function(key, val, options) {
      var attrs;
      if (key === null) return this;

      if (typeof key === 'object') {
        attrs = key;
        options = val;
      } else {
        (attrs = {})[key] = val;
      }

      options = options || {};

      // Deal with relations
      if (this.relations && _.isArray(this.relations)) {
        _.each(this.relations, function(relation) {
          // Look for embedded relations
          var relationAttrs = attrs[relation.key];
          var isModel = relationAttrs instanceof Backbone.Model;
          var isCollection = relationAttrs instanceof Backbone.Collection;
          if (relationAttrs && !isModel && !isCollection) {
            var object = _.clone(relationAttrs);
            delete attrs[relation.key];

            // Check for existing model/collection
            var oldEntity = this.get(relation.key);

            // To Many
            if (relation.collection) {
              // If existing collection exists, reuse it and reset it with new data
              if (oldEntity) {
                oldEntity.reset(object);
                attrs[relation.key] = oldEntity;
              } else {
                attrs[relation.key] = new relation.collection(object);
              }
              // To One
            } else if (relation.model) {
              // If existing model exists, reuse it and set it with new data
              if (oldEntity) {
                oldEntity.set(object);
                attrs[relation.key] = oldEntity;
              } else {
                attrs[relation.key] = new relation.model(object);
              }
            }
          }
        }.bind(this));
      }

      // Set the attributes and return it as that
      var that = Backbone.DeepModel.prototype.set.call(this, attrs, options);

      // Computed properties
      this.computedPropertyEvents(attrs);

      return this;
    },

    // Attach event listeners to the raw properties of the computed property
    computedPropertyEvents: function(attrs) {
      _.each(attrs, function(attr, prop) {
        if (_.isFunction(attr)) {
          _.each(attr.properties, function(property) {
            if (this.get(property) instanceof Backbone.Collection) {
              this.listenTo(this.get(property), 'change reset add remove sort', function() {
                var changed = this.get(prop);
                if (_.isFunction(this.get(prop))) {
                  changed = this.get(prop)
                    .call(this);
                }
                this.trigger('change:' + prop, this, changed);
              }.bind(this));
            } else if (this.get(property) instanceof Backbone.Model) {
              this.listenTo(this.get(property), 'change', function() {
                var changed = this.get(prop);
                if (_.isFunction(this.get(prop))) {
                  changed = this.get(prop)
                    .call(this);
                }
                this.trigger('change:' + prop, this, changed);
              }.bind(this));
            } else {
              this.listenTo(this, 'change:' + property, function() {
                var changed = this.get(prop);
                if (_.isFunction(this.get(prop))) {
                  changed = this.get(prop)
                    .call(this);
                }
                this.trigger('change:' + prop, this, changed);
              }.bind(this));
            }
          }.bind(this));
        }
      }.bind(this));
    },

    // Override toJSON to support relations and computed properties
    toJSON: function(options) {
      var json = Backbone.DeepModel.prototype.toJSON.call(this, options);

      // Deal with relations
      if (this.relations && _.isArray(this.relations)) {
        _.each(this.relations, function(relation) {
          // Look for embedded relations
          if (_.has(json, relation.key)) {
            var object;
            var entity = json[relation.key];
            if (entity && _.isFunction(entity.toJSON)) {
              object = entity.toJSON(options);
            }

            json[relation.key] = object;
          }
        }.bind(this));
      }

      // Computed properties
      // Remove computed properties from output
      _.each(json, function(val, key) {
        if (_.isFunction(val)) {
          delete json[key];
        }
      });

      return json;
    },
  });


  // Bangular.Model
  // ---
  // Extends Backbone.Collection and sets default model class to Bangular.Model
  Bangular.Collection = Backbone.Collection.extend({
    model: Bangular.Model,

    // Proxy for Array's move method and also fires a `sort` event
    move: function() {
      Array.prototype.move.apply(this.models, arguments);
      this.trigger('sort', this);
      return this;
    }
  });


  // Bangular.Region
  // ---
  // 
  // This is like a UIViewController
  // It has a property `view` that is shown in the DOM at location of the property `el`
  // If the region is closed via the `close` method, the `view` will be removed by calling it's `remove` method
  // If a region shows a view and an existing different view is currently being shown, it will be closed
  // 
  // Instance Options/Attributes
  // Prototype Properties and Methods
  // onBeforeShow
  // onShow
  // onBeforeClose
  // onClose
  Bangular.Region = function(options) {
    this.cid = _.uniqueId('region');
    options = options || {};
    _.extend(this, _.pick(options, ['el']));

    if (!this.el) {
      var err = new Error("An 'el' must be specified for a region.");
      err.name = "NoElError";
      throw err;
    }

    this.ensureEl();

    this.initialize.apply(this, arguments);
  };

  // Allow Bangular.Region to be extendable like Backbone.View
  Bangular.Region.extend = Backbone.View.extend;

  // Add methods to the prototype of Bangular.Region
  _.extend(Bangular.Region.prototype, Backbone.Events, {
    initialize: function() {},

    // Converts el to $el using the DOM manipulator
    ensureEl: function() {
      if (!this.$el || this.$el.length === 0) {
        this.$el = Bangular.$(this.el);
      }
    },

    // Determines if the region is showing a view or not
    isShowing: function() {
      return this.view ? true : false;
    },

    // Show a view in the region
    // This will replace any previous view shown in the region
    // options - object
    //  render - boolean - default true, whether the view should be rendered after show
    show: function(view, options) {
      options = options || {};
      _.defaults(options, {
        render: true
      });

      // Remove previous view if the new view is different by closing region
      if (this.view && this.view !== view) {
        this.close();
      }

      // Set current view
      this.view = view;

      // Set the view's region
      view.region = this;

      // This method gets called BEFORE show
      if (_.isFunction(this.onBeforeShow)) {
        this.onBeforeShow();
      }

      // Append the view DOM el into the region at the DOM location specified by `el`
      this.$el.empty()
        .append(view.el);

      // Render the view
      if (options.render) {
        view.render.call(view);
      }

      // This method gets called AFTER show
      if (_.isFunction(this.onShow)) {
        this.onShow();
      }

      return this;
    },

    // Remove the current view in the region
    close: function() {
      // This method gets called BEFORE close
      if (_.isFunction(this.onBeforeClose)) {
        this.onBeforeClose();
      }

      // Remove the view and null it
      if (this.view) {
        this.view.remove.call(this.view);
      }
      this.view = null;

      // This method gets called AFTER close
      if (_.isFunction(this.onClose)) {
        this.onClose();
      }

      // If this region has a loading view, show it now
      this.showLoading();

      return this;
    },

    // Show the loading view if it exists
    showLoading: function() {
      if (this.loadingView) {
        this.show(this.loadingView);
      }
    },

    // Alias for `close`
    reset: function() {
      return this.close();
    }

  });

  // Bangular.View
  // ---
  // 
  // Properties
  // subviews - Array of Bangular.View
  // superview - Bangular.View
  // 
  // Options (arguments passed in to constructor are added to the property `options` object)
  // locals - Object or Function - Properties that get mixed into the template context during template evaluation
  // 
  // Prototype
  // template - Function - required - compiled template function (handlebars, etc...)
  // onBeforeRender - Function - optional
  // onRender - Function - optional
  // onBeforeRemove - Function - optional
  // onRemove - Function - optional

  // Principles
  // ---
  // Render should be able to be called multiple times without side effects.
  // The order of the DOM should be declared in templates, not Javascript.
  // Calling render again should maintain the state the view was in.
  // Rendering twice shouldn’t trash views just to re-construct them again.
  // Rending multiple times should properly detach and attach event listeners
  Bangular.View = Backbone.View.extend({
    constructor: function(options) {
      // this exposes view options to the view initializer
      // this is a backfill since backbone removed the assignment of this.options
      this.options = _.extend({}, this.options, options);
      Backbone.View.prototype.constructor.apply(this, arguments);
    },

    // Because Backbone only allows certain view options to become properties,
    // we store the rest of them in the options property.
    // This is a convenience accessor to get a property that either belongs to the view or is in options
    getOption: function(property) {
      var value;

      if (this.options && (property in this.options) && (this.options[property] !== undefined)) {
        value = this.options[property];
      } else {
        value = this[property];
      }

      return value;
    },

    // Wraps the context with a model or collection for the events system
    wrapContext: function(context) {
      if (context && !_.isFunction(context) && _.isUndefined(context.on)) {
        if (_.isArray(context)) {
          context = new Bangular.Collection(context);
        } else if (_.isObject(context)) {
          context = new Bangular.Model(context);
        }
      }
      return context;
    },


    // Templating
    // ---
    // 
    // Evaluates a compiled template with context
    // TODO allow string templates to be evaluated on-the-fly
    evaluateTemplate: function(template) {
      return template(this.templateContext());
    },

    // Build the template context from model, collection, and locals
    templateContext: function() {
      // Populate model and collection properties with model and collection attributes
      var context = {
        model: this.model ? this.model.toJSON() : {},
        collection: this.collection ? this.collection.toJSON() : {}
      };

      // Mixin template locals
      var locals = this.getOption('locals') || {};
      if (_.isFunction(locals)) {
        locals = locals.call(this);
      }
      _.extend(context, locals);

      return context;
    },


    // View Bindings
    // ---
    // 
    // Add bindings declared with the `bind-*` attribute
    // `this` should always refer to the `view`
    // 
    // TODO
    // - `bind-focus`
    // - `bind-css`
    // 
    // - pass back options in transformers
    // 
    // Options:
    // - `el` is the root DOM element to bind to
    // - `model` is the Model or Collection to bind to
    // - `index` is the integer index when in the loop
    // - `keypathPrefix` is the prefix for keypath when in the loop
    addBindings: function(options) {
      // No el, no bind!
      if (!options.el) {
        return [];
      }


      // Variables
      var $el = $(options.el); // just for convenience
      var bindings = []; // keeps track of all bindings, returned by function


      // Binding functions/handlers
      var fns = {
        // Attr
        // Syntax: `bind-attr-*="keypath"`
        // Direction: Model-to-View
        bindAttr: function(bindEl, attrName, attrValue) {
          // Delayed removal of attributes
          var attributesToRemove;

          // Loop thru all attributes
          _.each(bindEl.attributes, function(attribute) {
            if (attribute.name.indexOf('bind-attr-') < 0) {
              return;
            }

            // Found a [bind-attr-*] attribute
            var $bindEl = $(bindEl);
            var attr = attribute.name.replace('bind-attr-', '');
            var keypath = $bindEl.attr(attribute.name);
            var modelEvents = 'change:' + keypath;
            var offset = 0;
            var pad = 0;

            // Override context
            var context = options.model;

            // If a context keypath is provided, override the context relative to the view
            if ($bindEl.attr('bind-attr-context')) {
              context = this[$bindEl.attr('bind-attr-context')];
            }

            // Binding
            var modelToView = function(model, value) {
              // Eval if value is a function
              if (_.isFunction(value)) {
                value = value.call(model);
              }

              $bindEl.attr(attr, value);
            }.bind(this);

            // Delayed removal of attributes
            attributesToRemove = attributesToRemove || [];
            attributesToRemove.push(attribute.name);

            // If all we need is the index
            if (keypath === '$index') {
              offset = _.parseInt($bindEl.attr('bind-index-offset') || 0);
              pad = _.parseInt($bindEl.attr('bind-index-pad') || 0);

              return $bindEl.attr(attr, _.str.lpad(options.index + offset, pad, '0'));
            }

            // Store binding for removal later
            bindings.push({
              object: context,
              events: modelEvents,
              handler: modelToView
            });


            context = this.wrapContext(context);
            // Bind model-to-view
            context.on(modelEvents, modelToView);
            modelToView(context, context.get(keypath));
          }.bind(this));

          // Delayed removal of attributes
          if (attributesToRemove) {
            _.each(attributesToRemove, function(attributeToRemove) {
              $(bindEl)
                .removeAttr(attributeToRemove);
            });
          }
        }.bind(this),


        // Repeat (ARRAY ONLY)
        // Syntax: `bind-array="keypath"`
        // Direction: N/A
        // Expects an Array not a Collection
        bindArray: function(bindEl, attrName, attrValue) {
          var $bindEl = $(bindEl);
          var $parentEl = $bindEl.parent();
          var $childEls = $();
          var direction = $bindEl.attr('bind-array-direction');
          var keypath = attrValue;
          var modelEvents = 'change:' + keypath;

          // Override context
          var context = options.model;
          context = this.wrapContext(context);

          // Remove attribute
          $bindEl.removeAttr(attrName);

          // If a context keypath is provided, override the context relative to the view
          if ($bindEl.attr('bind-array-context')) {
            context = this[$bindEl.attr('bind-array-context')];
          }

          // The binding function
          var modelToView = function(model, value) {
            var $childEl;

            // Eval if value is a function
            if (_.isFunction(value)) {
              value = value.call(model);
            }

            // Clear select container
            $childEls.remove();
            $childEls = $();

            // Value can be either an `array of strings` or a `collection`
            for (var i = 0; i < value.length; i++) {
              // Make a copy of the detached item
              $childEl = $bindEl.clone();

              $childEl.text(value[i]);

              $.merge($childEls, $childEl);
            }

            // Append item to parent container
            if (direction && direction === 'append') {
              $childEls.appendTo($parentEl);
            } else {
              $childEls.prependTo($parentEl);
            }
          }.bind(this);

          // Detach from DOM and cache it
          $bindEl.detach();

          // Store binding for removal later
          bindings.push({
            object: context,
            events: modelEvents,
            handler: modelToView
          });

          // Bind model-to-view
          context.on(modelEvents, modelToView);
          modelToView(context, context.get(keypath));
        }.bind(this),


        // With
        // Syntax: `bind-with="keypath"`
        bindWith: function(bindEl, attrName, attrValue) {
          var $bindEl = $(bindEl);
          var keypath = attrValue;
          var childBindings = [];
          var keypathPrefix = options.keypathPrefix ? options.keypathPrefix + '.' + keypath : keypath;

          // Override context
          var context = options.model;
          context = this.wrapContext(context);

          // Remove attribute
          $bindEl.removeAttr(attrName);

          // Remove child bindings
          this.childBindings = _.difference(this.childBindings, childBindings);
          this.removeBindings(childBindings);

          childBindings = childBindings.concat(this.addBindings({
            el: $bindEl,
            model: context.get(keypath),
            keypathPrefix: keypathPrefix
          }));

          // Add child bindings for removal later
          this.childBindings = this.childBindings || [];
          this.childBindings = this.childBindings.concat(childBindings);

          if (childBindings.length > 0) {
            Bangular.log("View: %s, Added %d bindings isChild: true, isIf: true", this.cid, childBindings.length);
          }
        }.bind(this),


        // If/Unless
        // Syntax: `bind-if="keypath"`
        bindIfUnless: function(bindEl, attrName, attrValue) {
          var $bindEl = $(bindEl);
          var keypath = attrValue;
          var modelEvents = 'change:' + keypath;
          var childBindings = [];

          // Override context
          var context = options.model;
          context = this.wrapContext(context);

          // Remove attribute
          $bindEl.removeAttr(attrName);

          // Make a clone and remove the original element
          var $contents = $bindEl.contents().clone();
          $bindEl.contents().empty().remove();

          // If a context keypath is provided, override the context relative to the view
          if ($bindEl.attr('bind-if-context')) {
            context = this[$bindEl.attr('bind-if-context')];
          }
          if ($bindEl.attr('bind-unless-context')) {
            context = this[$bindEl.attr('bind-unless-context')];
          }

          // Binding function
          var modelToView = function(model, value) {
            // Remove child bindings
            this.childBindings = _.difference(this.childBindings, childBindings);
            this.removeBindings(childBindings);

            // Clear container
            $bindEl.empty();

            // Eval if value is a function
            if (_.isFunction(value)) {
              value = value.call(model);
            }

            value = Boolean(value);

            if (attrName === 'bind-unless') {
              value = !value;
            }

            // Element should be active
            if (value) {
              var $childEl = $contents.clone();
              $bindEl.append($childEl);

              childBindings = childBindings.concat(this.addBindings({
                el: $childEl,
                model: model
              }));

              // Add child bindings for removal later
              this.childBindings = this.childBindings || [];
              this.childBindings = this.childBindings.concat(childBindings);

              if (childBindings.length > 0) {
                Bangular.log("View: %s, Added %d bindings isChild: true, isIf: true", this.cid, childBindings.length);
              }
            }
          }.bind(this);

          // Store binding for removal later
          bindings.push({
            object: context,
            events: modelEvents,
            handler: modelToView
          });

          // Bind model-to-view
          context.on(modelEvents, modelToView);
          modelToView(context, context.get(keypath));
        }.bind(this),


        // Each (COLLECTION ONLY)
        // Syntax: `bind-each="keypath"`
        // Direction: N/A
        // Note: a value of `this` behaves specially
        // Note: this binding needs to be parsed before all other bindings
        bindEach: function(bindEl, attrName, attrValue) {
          var $bindEl = $(bindEl);
          var direction = $bindEl.attr('bind-each-direction');
          var keypath = attrValue;
          var addEvents = 'add';
          var removeEvents = 'remove';
          var resetSortEvents = 'reset sort';
          var childBindings = [];
          var $childEls = $();

          // Override context
          var context = (keypath === 'this') ? options.collection : options.model.get(keypath);
          context = this.wrapContext(context);

          // Remove attribute
          $bindEl.removeAttr(attrName);

          // Clone and replace
          var $child = $bindEl.children().first().clone();
          $bindEl.children().first().remove();
          var $children = $bindEl.children();

          // Eval if value is a function
          if (_.isFunction(context)) {
            context = context.call(options.model);
          }

          // If a context keypath is provided, override the context relative to the view
          if ($bindEl.attr('bind-each-context')) {
            context = this[$bindEl.attr('bind-each-context')];
          }

          // Reset and Sort (multiple models at a time)
          var bindResetSort = function(collection, opts) {
            var $childEl;
            var isSelect = $bindEl.is('select');
            var keypathPrefix = options.keypathPrefix ? options.keypathPrefix + '.' + keypath : keypath;

            // Remove child bindings
            this.childBindings = _.difference(this.childBindings, childBindings);
            this.removeBindings(childBindings);

            // Clear parent container
            var previousVal = isSelect ? $bindEl.val() : null;
            $childEls.remove();
            $childEls = $();

            // For each Model (child) in the Collection (parent), add bindings
            for (var i = 0; i < collection.length; i++) {
              // Make a copy of the detached item
              $childEl = $child.clone();

              $.merge($childEls, $childEl);

              // Add bindings to the child
              childBindings = childBindings.concat(this.addBindings({
                el: $childEl,
                model: collection.at(i),
                index: i,
                keypathPrefix: keypathPrefix
              }));
            }

            // Append child to parent container
            if (direction && direction === 'prepend') {
              $childEls.prependTo($bindEl);
            } else {
              $childEls.appendTo($bindEl);
            }

            // Add bindings to rest of the children
            childBindings = childBindings.concat(this.addBindings({
              el: $children,
              model: options.model,
              index: options.index,
              keypathPrefix: options.keypathPrefix
            }));


            // Restore previous select val
            if (isSelect) {
              $bindEl.val(previousVal);
            }

            // Add child bindings for removal later
            this.childBindings = this.childBindings || [];
            this.childBindings = this.childBindings.concat(childBindings);

            if (childBindings.length > 0) {
              Bangular.log("View: %s, Added %d child bindings", this.cid, childBindings.length);
            }
          }.bind(this);

          // Adding one model at a time
          var bindAdd = function(model, collection, opts) {
            var $childEl = $child.clone();
            var index = collection.indexOf(model);
            var keypathPrefix = options.keypathPrefix ? options.keypathPrefix + '.' + keypath : keypath;

            $bindEl.insertAt(index, $childEl);
            $childEls.splice(index, 0, $childEl.get(0));

            // Add bindings to the child
            childBindings = childBindings.concat(this.addBindings({
              el: $childEl,
              model: model,
              index: index,
              keypathPrefix: keypathPrefix
            }));

            // Add child bindings for removal later
            this.childBindings = this.childBindings || [];
            this.childBindings = this.childBindings.concat(childBindings);

            if (childBindings.length > 0) {
              Bangular.log("View: %s, Added %d bindings isChild: true", this.cid, childBindings.length);
            }
          }.bind(this);

          // Removing one or more models at a time
          var bindRemove = function(model, collection, opts) {
            // TODO
            // Need a way to identify bindings to remove
            // For now just reset
            bindResetSort(collection);
          }.bind(this);

          // Store binding for removal later
          bindings.push({
            object: context,
            events: addEvents,
            handler: bindAdd
          });

          bindings.push({
            object: context,
            events: removeEvents,
            handler: bindRemove
          });

          bindings.push({
            object: context,
            events: resetSortEvents,
            handler: bindResetSort
          });

          // Bind
          context.on(addEvents, bindAdd);
          context.on(removeEvents, bindRemove);
          context.on(resetSortEvents, bindResetSort);
          bindResetSort(context, {});
        }.bind(this),


        // Text/HTML
        // Syntax: `bind-text="keypath"` and `bind-html="keypath"`
        // Direction: Model-to-View, View-to-Model
        // Note: Browser compat on View-to-Model might be poor
        bindTextAndHtml: function(bindEl, attrName, attrValue) {
          var $bindEl = $(bindEl);
          var keypath = attrValue;
          var modelEvents = 'change:' + keypath;
          var viewEvents = 'input';
          var offset = 0;
          var pad = 0;

          // Override context
          var context = options.model;
          context = this.wrapContext(context);

          // Remove attribute
          $bindEl.removeAttr(attrName);

          // If a context keypath is provided, override the context relative to the view
          if ($bindEl.attr('bind-text-context')) {
            context = this[$bindEl.attr('bind-text-context')];
          }
          if ($bindEl.attr('bind-html-context')) {
            context = this[$bindEl.attr('bind-html-context')];
          }

          var modelToView = function(model, value) {
            var keypathWithPrefix = options.keypathPrefix ? options.keypathPrefix + '.' + keypath : keypath;
            keypathWithPrefix = keypathWithPrefix.replace('this.', '');

            // Eval if value is a function
            if (_.isFunction(value)) {
              value = value.call(model);
            }

            // Check for any transformers
            var transformersFn = this.transformers && this.transformers.modelToView;
            if (transformersFn && _.isFunction(transformersFn[keypathWithPrefix])) {
              value = transformersFn[keypathWithPrefix].call(this, value, model);
            }

            // Set the value for the element if it has changed
            var fn = (attrName === 'bind-html') ? 'html' : 'text';
            if ($bindEl[fn]() !== value) {
              $bindEl[fn](value);
            }

            Bangular.log("Binding: %s, Model Attribute Change: %s", attrName, keypathWithPrefix);
          }.bind(this);

          var viewToModel = function(e) {
            var keypathWithPrefix = options.keypathPrefix ? options.keypathPrefix + '.' + keypath : keypath;
            keypathWithPrefix = keypathWithPrefix.replace('this.', '');

            var fn = (attrName === 'bind-html') ? 'html' : 'text';
            var value = $bindEl[fn]();

            var transformersFn = this.transformers && this.transformers.viewToModel;
            if (transformersFn && _.isFunction(transformersFn[keypathWithPrefix])) {
              value = transformersFn[keypathWithPrefix].call(this, value);
            }

            if (!_.isFunction(context.get(keypath))) {
              context.set(keypath, value);
            }

            Bangular.log("Binding: %s, View Event: %s", attrName, e.type);
          }.bind(this);

          // If all we need is the index
          if (keypath === '$index') {
            offset = _.parseInt($bindEl.attr('bind-index-offset') || 0);
            pad = _.parseInt($bindEl.attr('bind-index-pad') || 0);

            return $bindEl.text(_.str.lpad(options.index + offset, pad, '0'));
          }

          // Store model binding for removal later
          bindings.push({
            object: context,
            events: modelEvents,
            handler: modelToView
          });

          // Store view binding for removal later
          bindings.push({
            object: $bindEl,
            modelEvents: viewEvents,
            handler: viewToModel
          });

          // Bind view-to-model
          $bindEl.on(viewEvents, viewToModel);

          // Bind model-to-view
          context.on(modelEvents, modelToView);
          modelToView(context, context.get(keypath));
        }.bind(this),


        // Val
        // Syntax: `bind-val="keypath"`
        // Direction: Model-to-View, View-to-Model
        bindVal: function(bindEl, attrName, attrValue) {
          var $bindEl = $(bindEl);
          var keypath = attrValue;
          var isSelect = $bindEl.is('select');
          var modelEvents = 'change:' + keypath;
          var viewEvents = isSelect ? 'change' : 'textchange change';

          // Override context
          var context = options.model;
          context = this.wrapContext(context);

          // Remove attribute
          $bindEl.removeAttr(attrName);

          // If a context keypath is provided, override the context relative to the view
          if ($bindEl.attr('bind-val-context')) {
            context = this[$bindEl.attr('bind-val-context')];
          }

          // Override events
          viewEvents = $bindEl.attr('bind-val-events') ? $bindEl.attr('bind-val-events') : viewEvents;

          // Binding function
          var modelToView = function(model, value) {
            if (_.isUndefined(value)) {
              return;
            }

            var keypathWithPrefix = options.keypathPrefix ? options.keypathPrefix + '.' + keypath : keypath;
            keypathWithPrefix = keypathWithPrefix.replace('this.', '');

            // Eval if value is a function
            if (_.isFunction(value)) {
              value = value.call(model);
            }

            var transformersFn = this.transformers && this.transformers.modelToView;
            if (transformersFn && _.isFunction(transformersFn[keypathWithPrefix])) {
              value = transformersFn[keypathWithPrefix].call(this, value, model);
            }

            if ($bindEl.val() !== value) {
              $bindEl.val(value);

              if ($bindEl.is('select')) {
                $bindEl.attr('bind-select-val', value);
              }
            }

            Bangular.log("Binding: %s, Model Attribute Change: %s", attrName, keypathWithPrefix);
          }.bind(this);

          var viewToModel = function(e) {
            var keypathWithPrefix = options.keypathPrefix ? options.keypathPrefix + '.' + keypath : keypath;
            keypathWithPrefix = keypathWithPrefix.replace('this.', '');

            var value = $bindEl.val();

            if ($bindEl.is('select')) {
              $bindEl.attr('bind-select-val', value);
            }

            var transformersFn = this.transformers && this.transformers.viewToModel;
            if (transformersFn && _.isFunction(transformersFn[keypathWithPrefix])) {
              value = transformersFn[keypathWithPrefix].call(this, value);
            }

            if (!_.isFunction(context.get(keypath))) {
              context.set(keypath, value);
            }

            Bangular.log("Binding: %s, View Event: %s", attrName, e.type);
          }.bind(this);

          // Store binding for removal later
          bindings.push({
            object: context,
            events: modelEvents,
            handler: modelToView
          });

          // Store binding for removal later
          bindings.push({
            object: $bindEl,
            events: viewEvents,
            handler: viewToModel
          });

          // Bind view-to-model
          $bindEl.on(viewEvents, viewToModel);

          // Bind model-to-view
          context.on(modelEvents, modelToView);
          modelToView(context, context.get(keypath));
        }.bind(this),


        // Checked
        // Syntax: `bind-checked="keypath"`
        // Direction: Model-to-View, View-to-Model
        bindChecked: function(bindEl, attrName, attrValue) {
          var $bindEl = $(bindEl);
          var keypath = attrValue;
          var modelEvents = 'change:' + keypath;
          var viewEvents = 'change';

          // Override context
          var context = options.model;
          context = this.wrapContext(context);

          // Remove attribute
          $bindEl.removeAttr(attrName);

          // If a context keypath is provided, override the context relative to the view
          if ($bindEl.attr('bind-checked-ontext')) {
            context = this[$bindEl.attr('bind-checked-context')];
          }

          // Binding function
          var modelToView = function(model, value) {
            // Eval if value is a function
            if (_.isFunction(value)) {
              value = value.call(model);
            }

            value = Boolean(value);

            if ($bindEl.prop('checked') !== value) {
              $bindEl.prop('checked', value);
            }
          }.bind(this);

          var viewToModel = function(e) {
            var value = $bindEl.prop('checked');
            value = Boolean(value);

            if (!_.isFunction(context.get(keypath))) {
              context.set(keypath, value);
            }
          }.bind(this);

          // Store binding for removal later
          bindings.push({
            object: context,
            events: modelEvents,
            handler: modelToView
          });

          // Store binding for removal later
          bindings.push({
            object: $bindEl,
            events: viewEvents,
            handler: viewToModel
          });


          // Bind view-to-model
          $bindEl.on(viewEvents, viewToModel);

          // Bind model-to-view
          context.on(modelEvents, modelToView);
          modelToView(context, context.get(keypath));
        }.bind(this),


        // Visible/Hidden
        // Syntax: `bind-visible="keypath"` and `bind-hidden="keypath"`
        // Direction: Model-to-View
        bindVisibleAndHidden: function(bindEl, attrName, attrValue) {
          var $bindEl = $(bindEl);
          var keypath = attrValue;
          var modelEvents = 'change:' + keypath;

          // Override context
          var context = options.model;

          // Remove attribute
          $bindEl.removeAttr(attrName);

          // If a context keypath is provided, override the context relative to the view
          if ($bindEl.attr('bind-visible-context')) {
            context = this[$bindEl.attr('bind-visible-context')];
          }
          if ($bindEl.attr('bind-hidden-context')) {
            context = this[$bindEl.attr('bind-hidden-context')];
          }

          var modelToView = function(model, value) {
            // Eval if value is a function
            if (_.isFunction(value)) {
              value = value.call(model);
            }

            value = Boolean(value);

            if (attrName === 'bind-hidden') {
              value = !value;
            }

            $bindEl.toggle(value);
          }.bind(this);

          // Store binding for removal later
          bindings.push({
            object: context,
            events: modelEvents,
            handler: modelToView
          });


          context = this.wrapContext(context);
          // Bind model-to-view
          context.on(modelEvents, modelToView);
          modelToView(context, context.get(keypath));
        }.bind(this),


        // Enable/Disable
        // Syntax: `bind-enabled="keypath"` and `bind-disabled="keypath"`
        // Direction: Model-to-View
        bindEnableAndDisable: function(bindEl, attrName, attrValue) {
          var $bindEl = $(bindEl);
          var keypath = attrValue;
          var modelEvents = 'change:' + keypath;

          // Override context
          var context = options.model;
          context = this.wrapContext(context);

          // Remove attribute
          $bindEl.removeAttr(attrName);

          // If a context keypath is provided, override the context relative to the view
          if ($bindEl.attr('bind-enabled-context')) {
            context = this[$bindEl.attr('bind-enabled-context')];
          }
          if ($bindEl.attr('bind-disabled-context')) {
            context = this[$bindEl.attr('bind-disabled-context')];
          }

          var modelToView = function(model, value) {
            // Eval if value is a function
            if (_.isFunction(value)) {
              value = value.call(model);
            }

            value = Boolean(value);

            if (attrName === 'bind-disabled') {
              value = !value;
            }

            $bindEl.prop('disabled', !value);
          }.bind(this);

          // Store binding for removal later
          bindings.push({
            object: context,
            events: modelEvents,
            handler: modelToView
          });

          // Bind model-to-view
          context.on(modelEvents, modelToView);
          modelToView(context, context.get(keypath));
        }.bind(this),


        // Click/Submit
        // Syntax: `bind-click="fn"` and `bind-submit="fn"`
        // Direction: N/A
        // `context` is ALWAYS the `view`
        bindClickAndSubmit: function(bindEl, attrName, attrValue) {
          var $bindEl = $(bindEl);
          var fn = attrValue;
          var viewEvents = 'click';

          // Override context
          var context = this;

          // Remove attribute
          $bindEl.removeAttr(attrName);

          // If a context keypath is provided, override the context relative to the view
          if ($bindEl.attr('bind-click-context')) {
            context = this[$bindEl.attr('bind-click-context')];
          }
          if ($bindEl.attr('bind-submit-context')) {
            context = this[$bindEl.attr('bind-submit-context')];
          }

          if (attrName === 'bind-submit') {
            viewEvents = 'submit';
          }

          if (!_.isFunction(context[fn])) {
            return;
          }

          var bindFn = function(e) {
            context[fn].call(context, e, options);
          }.bind(this);

          // Store binding for removal later
          bindings.push({
            object: $bindEl,
            events: viewEvents,
            handler: bindFn
          });

          // Initial binding
          $bindEl.on(viewEvents, bindFn);
        }.bind(this)
      };


      // Parse DOM for bindings
      // The following `binding attributes` are supported
      var selectors = [
        '[bind-attr-src]',
        '[bind-attr-href]',
        '[bind-array]',
        '[bind-with]',
        '[bind-if]',
        '[bind-unless]',
        '[bind-each]',
        '[bind-text]',
        '[bind-html]',
        '[bind-val]',
        '[bind-checked]',
        '[bind-visible]',
        '[bind-hidden]',
        '[bind-enabled]',
        '[bind-disabled]',
        '[bind-click]',
        '[bind-submit]'
      ].join(',');

      // Get all `bind elements` that match the `binding attributes`
      var $bindEls = $.merge($el.filter(selectors), $el.find(selectors))
        .not('[bind-each] *')
        .not('[bind-if] *')
        .not('[bind-unless] *');

      // Loop
      // Shift all `bind elements` until empty
      // Bind them in order
      while ($bindEls.length > 0) {
        var bindEl = $bindEls.get(0);
        $bindEls.splice(0, 1);

        // This should not happen
        if (!bindEl) {
          return;
        }

        // All other bindings
        var bindAttrs = [];
        $.each(bindEl.attributes, function(attrIndex, attr) {
          bindAttrs.push({
            name: attr.name,
            value: attr.value
          });
        }.bind(this));

        // Map them to a `binding handler`
        _.each(bindAttrs, function(bindAttr) {
          switch (bindAttr.name) {
            case 'bind-each':
              fns.bindEach.call(this, bindEl, bindAttr.name, bindAttr.value);
              break;
            case 'bind-array':
              fns.bindArray.call(this, bindEl, bindAttr.name, bindAttr.value);
              break;
            case 'bind-with':
              fns.bindWith.call(this, bindEl, bindAttr.name, bindAttr.value);
              break;
            case 'bind-if':
              fns.bindIfUnless.call(this, bindEl, bindAttr.name, bindAttr.value);
              break;
            case 'bind-unless':
              fns.bindIfUnless.call(this, bindEl, bindAttr.name, bindAttr.value);
              break;
            case 'bind-text':
              fns.bindTextAndHtml.call(this, bindEl, bindAttr.name, bindAttr.value);
              break;
            case 'bind-html':
              fns.bindTextAndHtml.call(this, bindEl, bindAttr.name, bindAttr.value);
              break;
            case 'bind-val':
              fns.bindVal.call(this, bindEl, bindAttr.name, bindAttr.value);
              break;
            case 'bind-checked':
              fns.bindChecked.call(this, bindEl, bindAttr.name, bindAttr.value);
              break;
            case 'bind-visible':
              fns.bindVisibleAndHidden.call(this, bindEl, bindAttr.name, bindAttr.value);
              break;
            case 'bind-hidden':
              fns.bindVisibleAndHidden.call(this, bindEl, bindAttr.name, bindAttr.value);
              break;
            case 'bind-enabled':
              fns.bindEnableAndDisable.call(this, bindEl, bindAttr.name, bindAttr.value);
              break;
            case 'bind-disabled':
              fns.bindEnableAndDisable.call(this, bindEl, bindAttr.name, bindAttr.value);
              break;
            case 'bind-click':
              fns.bindClickAndSubmit.call(this, bindEl, bindAttr.name, bindAttr.value);
              break;
            case 'bind-submit':
              fns.bindClickAndSubmit.call(this, bindEl, bindAttr.name, bindAttr.value);
              break;
            default:
              // Catch all `bind-attr-*` bindings
              // Map them to the `bindAttr` handler
              var regexAttr = /^bind-attr-.+$/i;
              if (regexAttr.test(bindAttr.name)) {
                fns.bindAttr.call(this, bindEl, bindAttr.name, bindAttr.value);
              }
              break;
          }
        }.bind(this));
      }


      // End bindings
      if (_.isUndefined(options.index) && bindings.length > 0) {
        Bangular.log("View: %s, Added %d parent bindings", this.cid, bindings.length);
      }


      // Return all bindings to be released later
      return bindings;
    },


    // Removes all bindings bound with the `bind-*` attribute from current view
    // Should only be called with the view is being cleaned up
    removeBindings: function(bindings) {
      var count = 0,
        isChild = false;

      if (bindings) {
        isChild = true;
      } else {
        bindings = this.bindings || [];
      }

      var binding;
      while (binding = bindings.shift()) {
        binding.object = this.wrapContext(binding.object);
        binding.object.off(binding.events, binding.handler);
        count += 1;
      }

      if (count > 0) {
        if (isChild) {
          Bangular.log("View: %s, Removed %d child bindings", this.cid, count);
        } else {
          Bangular.log("View: %s, Removed %d parent bindings", this.cid, count);
        }
      }
    },


    // View Handling
    // ---
    // 
    // Forward all subview events to super view
    // Inspired by Marionette
    forwardChildViewEvents: function(view) {
      var prefix = "subview";

      this.listenTo(view, "all", function() {
        var args = Array.prototype.slice.call(arguments);
        var event = prefix + ":" + args.shift();

        this.trigger(event, args);
      }, this);

      return this;
    },

    // Render should be able to be called multiple times without side effects.
    // If the view has been rendered before, it will cleanup listeners/bindings and remove subviews recursively
    // Render will add listeners/bindings
    render: function(options) {
      Bangular.log("Rendering a view", this.cid);

      options = options || {};
      _.defaults(options, {});

      // Flag to determine if the view has been rendered before
      this.isRendered = this.isRendered || false;

      // Cleanup the current view if it has been previous rendered
      if (this.isRendered) {
        // Cleanup subviews, listeners, and bindings
        this.cleanup();
      }

      // This method gets called BEFORE render
      if (_.isFunction(this.onBeforeRender)) {
        this.onBeforeRender();
      }

      // Insert view into the DOM at el
      if (_.isFunction(this.template)) {
        this.$el.html(this.evaluateTemplate(this.template));
      }

      if (options.animate) {
        this.$el.hide()
          .show("fast");
      } else {
        this.$el.show();
      }

      // Add any model <-> view bindings
      this.bindings = this.addBindings({
        el: this.$el,
        model: this.model,
        collection: this.collection
      }) || [];

      this.delegateEvents.call(this);

      // Set view as rendered
      this.isRendered = true;

      // This method gets called AFTER render
      // This is a good place to add subviews
      if (_.isFunction(this.onRender)) {
        this.onRender();
      }

      return this;
    },

    cleanup: function() {
      // Remove subviews
      this.removeSubviews();

      // Remove any model <-> view bindings
      this.removeBindings();
      if (this.childBindings) {
        this.removeBindings(this.childBindings);
      }

      this.undelegateEvents.call(this);

      // Stop listening to any listenTo events
      this.stopListening();
    },

    // Remove will cleanup any listeners/bindings and remove subviews recursively
    remove: function(options) {
      Bangular.log("Removing a view", this.cid);

      options = options || {};
      _.defaults(options, {});

      // This method gets called BEFORE remove
      if (_.isFunction(this.onBeforeRemove)) {
        this.onBeforeRemove();
      }

      // Cleanup subviews, listeners, and bindings
      this.cleanup();

      // Remove current view el from the DOM
      var duration = 0;
      if (options.animate) {
        duration = "fast";
      }
      this.$el.hide(duration, function() {
        this.$el.remove();
      }.bind(this));

      // Set view as NOT rendered
      this.isRendered = false;

      // This method gets called AFTER remove
      if (_.isFunction(this.onRemove)) {
        this.onRemove();
      }

      return this;
    },

    // Adds a subview to the current view
    // Removed when parentView.removeSubviews is called
    // Removed when parentView.removeSubview is called
    addSubview: function(view, options) {
      if (!view) {
        return view;
      }

      options = options || {};
      _.defaults(options, {
        render: true
      });

      // Add view to parent's subviews
      this.subviews = this.subviews || [];
      this.subviews.push(view);

      // Set the view's superview
      view.superview = this;

      // Set the view's el if provided
      if (options.el) {
        if (options.append) {
          $(options.el)
            .append(view.el);
        } else {
          view.setElement.call(view, options.el);
        }
      }

      // Render new subview
      if (options.render) {
        view.render.call(view, options);
      }

      // Foward child view events to parent
      this.forwardChildViewEvents(view);

      return view;
    },

    // Removes a view from it's superview
    removeFromSuperview: function() {
      if (this.superview) {
        var index = _.indexOf(this.superview.subviews, this);
        this.superview.subviews.splice(index, 1);
      }

      return this;
    },

    removeSubview: function(view) {
      view.removeFromSuperview();
      view.remove();

      return this;
    },

    // Removes any subviews associated with this view which will in-turn remove any subviews of those views
    removeSubviews: function() {
      if (this.subviews) {
        _.invoke(this.subviews, 'remove');
        this.subviews = [];
      }

      return this;
    },

    // Cross browser implementation of preventDefault
    preventDefault: function(e) {
      if (e) {
        // prevent default action
        if (typeof e.preventDefault === "function") {
          e.preventDefault();
        }
        e.returnValue = false;
      }
    },

    // Cross browser implementation of stopPropagation
    stopPropagation: function(e) {
      if (e) {
        // no bubble
        if (typeof e.stopPropagation === "function") {
          e.stopPropagation();
        }
        e.cancelBubble = true;
      }
    },

    // Cross browser implementation of preventDefault and stopPropagation
    preventDefaultStopPropagation: function(e) {
      this.preventDefault(e);
      this.stopPropagation(e);
    },


    // Marionette.bindEntityEvents & unbindEntityEvents
    // ---
    //
    // These methods are used to bind/unbind a backbone "entity" (collection/model)
    // to methods on a target object.
    //
    // The first parameter, `target`, must have a `listenTo` method from the
    // EventBinder object.
    //
    // The second parameter is the entity (Backbone.Model or Backbone.Collection)
    // to bind the events from.
    //
    // The third parameter is a hash of { "event:name": "eventHandler" }
    // configuration. Multiple handlers can be separated by a space. A
    // function can be supplied instead of a string handler name.

    // Bind the event to handlers specified as a string of
    // handler names on the target object
    _bindFromStrings: function(target, entity, evt, methods) {
      var methodNames = methods.split(/\s+/);

      _.each(methodNames, function(methodName) {

        var method = target[methodName];
        if (!method) {
          Bangular.throwError("Method '" + methodName + "' was configured as an event handler, but does not exist.");
        }

        target.listenTo(entity, evt, method, target);
      });
    },

    // Bind the event to a supplied callback function
    _bindToFunction: function(target, entity, evt, method) {
      target.listenTo(entity, evt, method, target);
    },

    // Bind the event to handlers specified as a string of
    // handler names on the target object
    _unbindFromStrings: function(target, entity, evt, methods) {
      var methodNames = methods.split(/\s+/);

      _.each(methodNames, function(methodName) {
        var method = target[methodName];
        target.stopListening(entity, evt, method, target);
      });
    },

    // Bind the event to a supplied callback function
    _unbindToFunction: function(target, entity, evt, method) {
      target.stopListening(entity, evt, method, target);
    },


    // Loop all bindings
    _iterateEvents: function(target, entity, bindings, functionCallback, stringCallback) {
      if (!entity || !bindings) {
        return;
      }

      // allow the bindings to be a function
      if (_.isFunction(bindings)) {
        bindings = bindings.call(target);
      }

      // iterate the bindings and bind them
      _.each(bindings, function(methods, evt) {
        // allow for a function as the handler,
        // or a list of event names as a string
        if (_.isFunction(methods)) {
          functionCallback(target, entity, evt, methods);
        } else {
          stringCallback(target, entity, evt, methods);
        }
      });
    },

    bindEntityEvents: function(target, entity, bindings) {
      this._iterateEvents(target, entity, bindings, this._bindToFunction, this._bindFromStrings);
    },

    unbindEntityEvents: function(target, entity, bindings) {
      this._iterateEvents(target, entity, bindings, this._unbindToFunction, this._unbindFromStrings);
    },

    // Extending to handle custom event observers
    delegateEvents: function(events) {
      Backbone.View.prototype.delegateEvents.apply(this, arguments);

      this.unbindEntityEvents(this, this.model, this.modelEvents);
      this.unbindEntityEvents(this, this.collection, this.collectionEvents);
      this.bindEntityEvents(this, this.model, this.modelEvents);
      this.bindEntityEvents(this, this.collection, this.collectionEvents);
    },

    undelegateEvents: function() {
      Backbone.View.prototype.undelegateEvents.apply(this, arguments);

      this.unbindEntityEvents(this, this.model, this.modelEvents);
      this.unbindEntityEvents(this, this.collection, this.collectionEvents);
    }
  });


  // Collection View
  // ---
  // 
  // Mostly inspired by Marionette
  Bangular.CollectionView = Bangular.View.extend({
    render: function() {
      Bangular.View.prototype.render.apply(this, arguments);

      this.renderList();

      return this;
    },

    // TODO optimize with document fragments
    renderList: function() {
      this.collection.each(function(model) {
        var itemView = new this.ItemView({
          model: model
        });
        this.addSubview(itemView);
        $(this.listEl)
          .append(itemView.el);
      }, this);

      return this;
    }
  });

})(this, Backbone, _);