import { observe } from '../observer/index'

import { initComputed } from '../observer/computed'

import Vue from '../vue'

import {
  proxy,
  getByPath
} from '../helper/utils'

import { warn } from '../helper/log'

// 兼容在web和小程序平台中创建表现一致的store

import mapStore from './mapStore'

function transformGetters (getters, model, store) {
  const newGetters = {}
  for (let key in getters) {
    if (key in store.getters) {
      warn(`Duplicate getter type: ${key}.`)
    }
    const getter = function () {
      if (store.withThis) {
        return getters[key].call({
          state: model.state,
          getters: store.getters,
          rootState: store.state
        })
      }
      return getters[key](model.state, store.getters, store.state)
    }
    newGetters[key] = getter
  }
  return newGetters
}

function transformMutations (mutations, model, store) {
  const newMutations = {}
  for (let key in mutations) {
    if (store.mutations[key]) {
      warn(`Duplicate mutation type: ${key}.`)
    }

    const mutation = function (...payload) {
      if (store.withThis) return mutations[key].apply({ state: model.state }, payload)
      return mutations[key](model.state, ...payload)
    }
    newMutations[key] = mutation
  }
  return newMutations
}

function transformActions (actions, model, store) {
  const newActions = {}
  for (let key in actions) {
    if (store.actions[key]) {
      warn(`Duplicate action type: ${key}.`)
    }
    newActions[key] = function (...payload) {
      const context = {
        rootState: store.state,
        state: model.state,
        getters: store.getters,
        dispatch: store.dispatch.bind(store),
        commit: store.commit.bind(store)
      }

      let result
      if (store.withThis) {
        result = actions[key].apply(context, payload)
      } else {
        result = actions[key](context, ...payload)
      }
      // action一定返回一个promise
      if (result && typeof result.then === 'function' && typeof result.catch === 'function') {
        return result
      } else {
        return Promise.resolve(result)
      }
    }
  }
  return newActions
}

function mergeDeps (model, deps) {
  const mergeProps = ['state', 'getters', 'mutations', 'actions']
  Object.keys(deps).forEach(key => {
    const store = deps[key]
    mergeProps.forEach(prop => {
      if (model[prop] && (key in model[prop])) {
        warn(`Deps's name [${key}] conflicts with ${prop}'s key in current options.`)
      } else {
        model[prop] = model[prop] || {}
        if (prop === 'getters') {
          // depsGetters单独存放，不需要重新进行初始化
          model.depsGetters = model.depsGetters || {}
          model.depsGetters[key] = store.getters
          // model[prop][key] = () => store[prop]
        } else {
          model[prop][key] = store[prop]
        }
      }
    })
  })
}

class Store {
  constructor (options) {
    const {
      plugins = []
    } = options
    this.withThis = options.withThis
    this.__wrappedGetters = {}
    this.__depsGetters = {}
    this.getters = {}
    this.mutations = {}
    this.actions = {}
    this._subscribers = []
    this.state = this.registerModule(options).state
    this.resetStoreVM()
    Object.assign(this, mapStore(this))
    plugins.forEach(plugin => plugin(this))
  }

  dispatch (type, ...payload) {
    const action = getByPath(this.actions, type)
    if (!action) {
      return Promise.reject(new Error(`unknown action type: ${type}`))
    } else {
      return action(...payload)
    }
  }

  commit (type, ...payload) {
    const mutation = getByPath(this.mutations, type)
    if (!mutation) {
      warn(`Unknown mutation type: ${type}.`)
    } else {
      mutation(...payload)
      return this._subscribers.slice().forEach(sub => sub({ type, payload }, this.state))
    }
  }

  subscribe (fn, options) {
    return genericSubscribe(fn, this._subscribers, options)
  }

  registerModule (model) {
    const state = model.state || {}
    const reactiveModule = {
      state
    }
    if (model.getters) {
      reactiveModule.getters = transformGetters(model.getters, reactiveModule, this)
    }
    if (model.mutations) {
      reactiveModule.mutations = transformMutations(model.mutations, reactiveModule, this)
    }
    if (model.actions) {
      reactiveModule.actions = transformActions(model.actions, reactiveModule, this)
    }
    if (model.deps) {
      mergeDeps(reactiveModule, model.deps)
    }
    Object.assign(this.__depsGetters, reactiveModule.depsGetters)
    Object.assign(this.__wrappedGetters, reactiveModule.getters)
    // merge mutations
    Object.assign(this.mutations, reactiveModule.mutations)
    // merge actions
    Object.assign(this.actions, reactiveModule.actions)
    // 子model
    if (model.modules) {
      const childs = model.modules
      Object.keys(childs).forEach(key => {
        reactiveModule.state[key] = this.registerModule(childs[key]).state
      })
    }
    return reactiveModule
  }

  resetStoreVM () {
    if (__mpx_mode__ === 'web') {
      this._vm = new Vue({
        data: {
          __mpxState: this.state
        },
        computed: this.__wrappedGetters
      })
      const computedKeys = Object.keys(this.__wrappedGetters)
      proxy(this.getters, this._vm, computedKeys)
      proxy(this.getters, this.__depsGetters)
    } else {
      this._vm = {}
      observe(this.state, true)
      initComputed(this._vm, this.getters, this.__wrappedGetters)
      proxy(this.getters, this.__depsGetters)
    }
  }
}

function genericSubscribe (fn, subs, options) {
  if (subs.indexOf(fn) < 0) {
    options && options.prepend
      ? subs.unshift(fn)
      : subs.push(fn)
  }
  return () => {
    const i = subs.indexOf(fn)
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}

export default function createStore (options) {
  return new Store(options)
}

// auxiliary functions
export function createState (state) {
  return state
}
export function createGetters (state, getters, deps = {}) {
  return getters
}
export function createMutations (state, mutations, deps = {}) {
  return mutations
}
export function createActions (state, getters, mutations, actions, deps = {}) {
  return actions
}

export function createStoreWithThis (options) {
  options.withThis = true
  return new Store(options)
}
