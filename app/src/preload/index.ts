import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api } from '@shared/api'

const api: Api = {
  getCatalog: () => ipcRenderer.invoke('catalog:get'),
  scanGame: () => ipcRenderer.invoke('game:scan'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  saveProfile: (p) => ipcRenderer.invoke('profiles:save', p),
  deleteProfile: (id) => ipcRenderer.invoke('profiles:delete', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  listRules: () => ipcRenderer.invoke('rules:list'),
  saveRules: (r) => ipcRenderer.invoke('rules:save', r),
  listContributions: () => ipcRenderer.invoke('contributions:list'),
  addContribution: (c) => ipcRenderer.invoke('contributions:add', c),
  packConflicts: (paths) => ipcRenderer.invoke('packs:conflicts', paths),
  launchGame: (paths) => ipcRenderer.invoke('game:launch', paths),
  subscribeWorkshop: (ids) => ipcRenderer.invoke('steam:subscribe', ids),
  installFromFile: (modId) => ipcRenderer.invoke('install:file', modId),
  installFromLoversLab: (url, modId) => ipcRenderer.invoke('install:loverslab', url, modId),
  backupPacks: (paths) => ipcRenderer.invoke('install:backup', paths),
  packFacts: (paths) => ipcRenderer.invoke('packs:facts', paths),
  installPaths: (paths) => ipcRenderer.invoke('install:paths', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  workshopDetails: (ids) => ipcRenderer.invoke('steam:details', ids),
  onSteamProgress: (cb) => {
    const listener = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p)
    ipcRenderer.on('steam:progress', listener)
    return () => ipcRenderer.removeListener('steam:progress', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
