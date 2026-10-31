import { contextBridge, ipcRenderer } from 'electron'
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
  addContribution: (c) => ipcRenderer.invoke('contributions:add', c)
}

contextBridge.exposeInMainWorld('api', api)
