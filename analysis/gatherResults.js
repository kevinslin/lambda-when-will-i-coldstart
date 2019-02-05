"use strict"
const { env } = require("./constants")
const AWS = require("aws-sdk")
const _ = require("lodash")
const csvWriter = require("csv-write-stream")

const fs = require("fs")
const moment = require("moment")
const util = require("util")

let region = process.env.AWS_DEFAULT_REGION
AWS.config.update({ region })
console.log({ config: AWS.config })
const cloudwatch = new AWS.CloudWatch()
const stepfunctions = new AWS.StepFunctions()
const cloudwatchlogs = new AWS.CloudWatchLogs()
const bunyan = require("bunyan")

const log = bunyan.createLogger({ name: "app", level: "debug" })

function _date(date) {
  return moment(date)
}

function _cwId(label) {
  return label.replace(/-/gi, "_")
}

async function _sleep() {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      log.debug("waiting 1s")
      resolve()
    }, 1000)
  })
}

function _stepIdFromCwId(label) {
  return label.replace(/_/gi, "-") + "-" + env("FUNCTION_SUFFIX")
}

function _MemFromCwId(label) {
  return parseInt(label.split("-").slice(-1))
}

function writeCsv({ path, data }) {
  log.info({ ctx: "writeCsv", path })
  log.info({ data })
  let writer = csvWriter()
  writer.pipe(fs.createWriteStream(path))
  data.forEach(line => {
    writer.write(line)
  })
  writer.end()
}

async function getStepFunctions({ stateMachineArn, filter }) {
  let params = _.defaults(
    {
      statusFilter: "SUCCEEDED",
      maxResults: 100
    },
    { stateMachineArn }
  )
  log.info({ ctx: "getStepFunctions", params })
  let functions = await stepfunctions.listExecutions(params).promise()
  log.debug({ ctx: "getStepFunctions", functions })
  return _.filter(functions.executions, ent => {
    return ent.name.indexOf(filter) >= 0
  })
}

function getStartStop({ functions }) {
  log.debug({ ctx: "getStartStop", functions })
  let { startDate: start, stopDate: stop } = functions[0]
  start = moment(start)
  stop = moment(stop)
  functions.forEach(f => {
    let { startDate, stopDate } = f
    startDate = _date(startDate)
    stopDate = _date(stopDate)
    if (startDate.isBefore(start)) {
      start = startDate
    }
    if (stopDate.isAfter(stop)) {
      stop = stopDate
    }
  })
  return {
    start,
    stop
  }
}

async function collectDataV2({ startTime, endTime }) {
  let logGroupName = "/aws/lambda/when-will-i-coldstart-dev-find-idle-timeout"
  let queryString =
    " fields @timestamp, coldstarts, interval, target, @message | sort @timestamp desc | limit 500| filter (coldstarts > 0)"
  const params = {
    endTime,
    startTime,
    logGroupName,
    queryString
  }
  log.info("logs.startQuery", { params })
  let res = await cloudwatchlogs.startQuery(params).promise()
  let queryId = res.queryId
  log.info("logs.getQueryResults", { queryId })
  res = {
    status: "Running"
  }
  while (res.status === "Running") {
    res = await cloudwatchlogs.getQueryResults({ queryId }).promise()
    await _sleep()
  }
  return res
}

// collect data
function collectData({ StartTime, EndTime, MetricDataQueries }) {
  log.debug({ ctx: "collectData", StartTime, EndTime })
  MetricDataQueries = MetricDataQueries.map(p => {
    return {
      Id: _cwId(p.FunctionValue),
      MetricStat: {
        Metric: {
          Dimensions: [
            {
              Name: "functionName",
              Value: p.FunctionValue
            }
          ],
          MetricName: "coldstart",
          Namespace: "ColdstartTest"
        },
        Period: 60,
        Stat: "Sum",
        Unit: "Count"
      }
    }
  })
  log.debug({ MetricDataQueries })
  let req = {
    StartTime: StartTime,
    EndTime: EndTime,
    MetricDataQueries
  }
  return cloudwatch.getMetricData(req).promise()
}

// generate derived data
function analyzeData({ metricResults, startDate }) {
  log.info({ ctx: "analyzeData", startDate })
  log.debug({ metricResults })
  let out = []
  let prev = startDate
  let { Id, Timestamps } = metricResults
  log.debug({ Id, Timestamps })
  _.reverse(Timestamps).forEach(ts => {
    ts = moment(ts)
    let min = moment.duration(ts.diff(prev)).as("minutes")
    log.debug({ prev, ts, min })
    out.push([min, ts])
    prev = ts
  })
  return out
}

// export csv

async function main() {
  log.info("start")
  const suffix = env("FUNCTION_SUFFIX")
  const stateMachineArn = env("STATE_MACHINE_ARN")

  let functions = await getStepFunctions({
    stateMachineArn,
    filter: suffix
  })
  let { start, stop } = getStartStop({ functions })
  start = _date(start)
  stop = _date(stop)
  log.info({ start, stop })
  let data = await collectDataV2({
    startTime: start.unix(),
    endTime: stop.unix()
  })
  let { results } = data
  results = results.map(u => {
    let [ts, coldstarts, interval, target] = u.map(v => v.value)
    log.debug({ u, bond: true, ts, target })
    return {
      ts,
      coldstarts,
      interval,
      mem: _MemFromCwId(target)
    }
  })
  log.debug("filtered results", results)
  writeCsv({ path: "/tmp/out.csv", data: results })
  log.info("done")
}

main()
