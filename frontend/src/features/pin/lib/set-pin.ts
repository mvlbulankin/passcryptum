import { setPinKind } from '../model'

export const setOnlinePin = () => {
  setPinKind.value = 'online'
}

export const setOfflinePin = () => {
  setPinKind.value = 'offline'
}
