require("dotenv").config()
const MEM_SIZES = [
  "128",
  "256",
  "512",
  "1024",
  "1152",
  "1280",
  "1408",
  "1536",
  "1792",
  "1856",
  "2048",
  "2240",
  "2432",
  "2624",
  "2816",
  "3008"
]

const env = key => {
  return process.env[key]
}

module.exports = {
  MEM_SIZES,
  env
}
