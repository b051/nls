import * as child_process from 'child_process'

export const exec = (cmd: string) => new Promise<{ stdout: string, stderr: string }>((resolve, reject) => {
  child_process.exec(cmd, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      reject(error)
    } else {
      resolve({ stdout, stderr })
    }
  })
})
