"use strict"
const AWS = require("aws-sdk")
const sf = new AWS.StepFunctions()
const bunyan = require("bunyan")
const log = bunyan.createLogger({ name: "app", level: "debug" })
const process = require("process")
const moment = require("moment")
const { env, MEM_SIZES } = require("./constants")

const genLambdaName = mem =>
  `when-will-i-coldstart-dev-system-under-test-${mem}`

const genSfName = seed =>
  `${seed}-${moment()
    .utc()
    .format("MMDDYYYYTHHmm")}`

async function main() {
  log.info("start")
  MEM_SIZES.forEach(async size => {
    let lambdaName = genLambdaName(size)
    let sfName = genSfName(lambdaName)
    let params = {
      stateMachineArn: env("STATE_MACHINE_ARN"),
      input: JSON.stringify({
        target: lambdaName,
        interval: 600,
        coldstarts: 0
      }),
      name: sfName
    }
    log.info({ params })
    let sfExecutionResult = await sf.startExecution(params).promise()
    log.info({ sfExecutionResult })
  })
  log.info("done")
}

main()
