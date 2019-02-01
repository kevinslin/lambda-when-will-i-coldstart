'use strict';
const AWS        = require('aws-sdk');
const cloudwatch = new AWS.CloudWatch({region: 'us-west-2'})

let isColdstart = false;

let trackColdstart = async (funcName) => {
  let req = {
    MetricData: [
      {
        MetricName: `coldstart`,
        Dimensions: [ { Name: "functionName", Value: funcName } ],
        Timestamp: new Date(),
        Unit: 'Count',
        Value: 1
      }
    ],
    Namespace: "ColdstartTest"
  };
  return cloudwatch.putMetricData(req).promise();
}

module.exports.handler = async (event, context, callback) => {
  if (!isColdstart) {
    isColdstart = true;
    let cwRes = await trackColdstart(context.functionName);
    console.log({cwRes});
    callback(null, { isColdstart : true });
  } else {
    callback(null, { isColdstart : false });
  }
}
