import process from 'node:process'

/** Which process is serving, for a test waiting on a handover to a fork. */
export default () => ({ pid: process.pid })
