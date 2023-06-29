const inquirer = require("inquirer")

async function getOrRequestDetails() {
  if (process.argv[2]) {
    [_, __, name, url, username, password] = process.argv
    return {name, url, username, password}
  }
  return inquirer.prompt([
    {
      name: 'name',
      message: 'We\'re going to download a static copy of a prototype, what name do you want to use for this copy?'
    }, 
    {
      name: 'url',
      message: 'What\'s the URL (address) of the prototype you want to copy?'
    },
    {
      name: 'username',
      message: 'If it needs a username to log in, what is that username?'
    },
    {
      name: 'password',
      message: 'If it needs a password to log in what is that password?',
      type: 'password'
    }
  ])
    .then((answers) => {
      console.table(answers)
      return answers
    })
}

module.exports = {
  getOrRequestDetails
}
