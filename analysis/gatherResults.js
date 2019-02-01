"use strict"
const AWS = require("aws-sdk")
const _ = require("lodash")
const csvWriter = require("csv-write-stream")

const fs = require("fs")
const moment = require("moment")
const util = require("util")

const cloudwatch = new AWS.CloudWatch()
const stepfunctions = new AWS.StepFunctions()
const bunyan = require("bunyan")
const { env } = require("./constants")

const log = bunyan.createLogger({ name: "app", level: "debug" })

function _date(date) {
  return moment(date)
}

function _cwId(label) {
  return label.replace(/-/gi, "_")
}

function _stepIdFromCwId(label) {
  return label.replace(/_/gi, "-") + "-" + env("FUNCTION_SUFFIX")
}

function _MemFromCwId(label) {
  return parseInt(label.split("-").slice(-2, -1))
}

function writeCsv({ path, data}) {
  log.info({ctx: "writeCsv", path})
  log.info({data})
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
  log.debug({ ctx: "getStepFunctions", params })
  let functions = await stepfunctions.listExecutions(params).promise()
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
    out.push(min)
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
  log.info({ start, stop, functions })

  let MetricDataQueries = functions.map(f => {
    let { startDate, stopDate, name } = f
    startDate = _date(startDate).unix()
    stopDate = _date(stopDate).unix()
    return {
      StartTime: startDate,
      EndTime: stopDate,
      FunctionValue: name.slice(0, name.indexOf("-" + env("FUNCTION_SUFFIX")))
    }
  })

  let data = await collectData({
    // don't want to count first metric from lambda execution
    StartTime: start.unix() + 1000,
    EndTime: stop.unix(),
    MetricDataQueries
  })
  let results = []
  log.info({ ctx: "collected data", data })
  data.MetricDataResults.forEach(mr => {
    let { Id } = mr
    // id:  when_will_i_coldstart_dev_system_under_test_128
    // name: "when-will-i-coldstart-dev-system-under-test-128-01292019T0708",
    Id = _stepIdFromCwId(Id)
    let { startDate, stopDate } = _.find(functions, { name: Id })
    let derived = analyzeData({
      metricResults: mr,
      startDate: moment(startDate)
    })
    // cut 1st result to account for search of initial coldstart
    derived = derived.slice(1)
    derived = derived.map(u => {
      return { name: _MemFromCwId(Id), time: u }
    })
    log.info(derived)
    results = _.concat(results, derived)
  })
  writeCsv({path: "/tmp/out.csv", data: results})
  log.info("done")

  //let {MetricDataResults} = data
  //log.info({results: JSON.stringify(MetricDataResults)});

  //let data = fs.readFileSync('./fixtures/sample-response.json', 'utf8')
  //data = JSON.parse(data)
  //let startTime = '2019-01-27T03:56:00.000Z"'
  //startTime = moment("2019-01-27T03:56:00.000Z")
  //log.info({startTime});
  //let derived = analyzeData({data, startTime})
}

main()
//try {
//let out = writeCsv({path: "/tmp/out.csv", data: [
  //{a:1, b:2},
  //{a:1, b:2},
//]})
//} catch(err) {
  //log.error(err)
//}
//log.info("done")
