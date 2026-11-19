import pg from 'pg';
if(process.env.NODE_ENV==='production'||process.env.REPLIT_DEPLOYMENT==='1')throw Error('Post-merge migration is development-only; production schema is Publish-owned');
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
try{
 await client.connect();
 const {rows}=await client.query('SELECT current_database() AS name');
 const name=rows[0].name;
 if(!/^(heliumdb|liberty_dev(?:elopment)?(?:_[a-z0-9]+)?|test_sfp2060_[a-z0-9_]+)$/.test(name))throw Error('Unrecognized development database; migration refused');
 console.log('Verified recognized development database');
}finally{await client.end();}
