// Runs in its own process so each scenario sees exactly the AWS environment under test.
// Prints one line, `RESULT <json>`, with whether each bucket loaded.
const { DuckDBInstance } = require('@duckdb/node-api');

(async () => {
  const { loadFile, prepareDataFileReader } = await import(process.env.LOADER);
  const database = await DuckDBInstance.create(':memory:');
  const conn = await database.connect();
  const run = async (sql) => {
    const result = await conn.run(sql);
    return { columns: result.columnNames(), rows: await result.getRowsJson() };
  };
  await run(`SET s3_endpoint='${process.env.ENDPOINT}'`);
  await run('SET s3_use_ssl=false');
  await run("SET s3_url_style='path'");
  await run("SET s3_region='us-east-1'");
  const adapter = {
    query: run,
    transaction: async (callback) => {
      await run('BEGIN TRANSACTION');
      try {
        const value = await callback({ query: run });
        await run('COMMIT');
        return value;
      } catch (error) {
        await run('ROLLBACK');
        throw error;
      }
    },
  };
  const results = [];
  for (const [index, bucket] of JSON.parse(process.env.BUCKETS).entries()) {
    const source = `s3://${bucket}/data.csv`;
    try {
      await prepareDataFileReader(adapter, source);
      await loadFile(adapter, source, 'auto', 64, `scenario_${index}`);
      const rows = await run(`SELECT COUNT(*) FROM scenario_${index}`);
      results.push({ bucket, ok: Number(rows.rows[0][0]) === 3 });
    } catch (error) {
      results.push({
        bucket,
        ok: false,
        error: String(error.message).split('\n')[0].slice(0, 200),
      });
    }
  }
  console.log(`RESULT ${JSON.stringify(results)}`);
  process.exit(0);
})().catch((error) => {
  console.log(`RESULT ${JSON.stringify([{ bucket: '(setup)', ok: false, error: String(error) }])}`);
  process.exit(1);
});
