var pg = require('pg-promise')();
var glob = require('glob');
var Promise = require('bluebird');
var path = require('path');
var fs = require('fs');

function Manager(db_config){
	this.db = pg(db_config);
	this.config = db_config;

	this.management_db = pg({
		host: db_config.host,
		port: db_config.port,
		database: 'postgres',
		user: db_config.user,
		password: db_config.password
	});
}
Manager.prototype.dropDatabase = function () {
	var self = this;
	return self.disconnectUsers()
	.then(function () {
		return self.management_db.query("DROP DATABASE if exists " + self.config.database);
	})
	.then(function(val){
		//success
	});
};

Manager.prototype.createDatabase = function () {
	var self = this;
	return self.management_db.query("CREATE DATABASE " + self.config.database)
	.then(function(val){
		//reload connection
		self.db = pg(self.config);
	});
};
Manager.prototype.disconnectUsers = function () {
	var self = this;
	var query = "SELECT pg_terminate_backend(pg_stat_activity.pid) " +
		"FROM pg_stat_activity " +
		"WHERE pg_stat_activity.datname = ${db_name} " +
  		"AND pid <> pg_backend_pid();"
	return self.management_db.query(query, {
		db_name: self.config.database
	})
	.then(function () {
		//success
	});
};

Manager.prototype.checkIfTableExists = function (table_name) {
	var self = this;
	var query = "select * from pg_tables where schemaname='public' and tablename = ${table_name}";
	return self.db.query(query, {
		table_name: table_name
	})
	.then(function (output) {
		return output.length > 0;
	});
};

Manager.prototype.getSchemaVersion = function (){
	var self = this;
	return self.checkIfTableExists("schema_changes")
	.then(function (exists) {
		if(exists){
			return self.db.query("select version from schema_changes order by timestamp desc limit 1;")
			.then(function (result) {
				if(result.length == 0){
					return 0;
				}else{
					return result[0].version;
				}
			});
		}else{
			return 0;
		}
	});
};

Manager.prototype.getSqlFiles = function () {
	return new Promise(function (resolve,reject){
		glob("schema_updates/*.sql",{}, function (err, files) {
			if(err){
				reject(err);
			}else{
				resolve(files);	
			}
		});
	});
};

Manager.prototype.getSqlList = function () {
	var self = this;
	
	return self.getSqlFiles()
	.then(function (files) {
		var sqlList = {};
		for(var a=0; a<files.length; a++){
			var fileNumber = path.basename(files[a]).split('.')[0];
			sqlList[fileNumber] = files[a];
		}
		for (var key in sqlList) {
			if (sqlList.hasOwnProperty(key)) {
				var num = parseInt(key);
				if(num <= 0 || num > files.length || isNaN(num)){
					throw new Error("Unexpected file: '" + sqlList[key] +
						"' Filenames must be a number in sequential order, starting at 1, and ending with '.sql'");
				}
			}
		}
		sqlList.length = files.length;
		return sqlList;		
	});
};

Manager.prototype.ensureSchemaChangesTableExists = function () {
	var self = this;
	return self.checkIfTableExists("schema_changes")
	.then(function (exists) {
		if(!exists){
			var query = "CREATE TABLE schema_changes " +
			"( " +
  			"id bigserial NOT NULL, " +
  			"version bigint, " +
  			"\"timestamp\" timestamp with time zone DEFAULT now(), " +
  			"CONSTRAINT schema_changes_pkey PRIMARY KEY (id) " +
			")";
			return self.db.query(query);
		}
	});
};

Manager.prototype.readFile = function (file) {
	return new Promise(function (resolve, reject){
		fs.readFile(file, function (err,data) {
			if (err) {
				reject(err);
			}
			resolve(data);
		});
	});
};

Manager.prototype.runMigration = function(file, version){
	var self = this;
	console.log("running migration: ", version, "file=", file);
	return self.readFile(file)
	.then(function (data) {
		var query = data.toString();
		return self.db.tx(function (tx) {
			console.log("query:", query);
			var queries = [];
			queries.push(tx.any(query));
			queries.push(tx.any("insert into schema_changes (version) VALUES (" + version + ")"),{
				version: version
			});
			return Promise.all(queries)
			.then(function () {
				console.log("query done");
			});
		});
	})
	.then(function () {
		console.log("1 migration done");
	});
};

Manager.prototype.updateSchema = function () {
	var self = this;
	
	return self.getSchemaVersion()
	.then(function (currentVersion) {
		console.log("current version: ", currentVersion);
		return self.getSqlList()
		.then(function (sqlList) {
			console.log("sqlList: ", sqlList);
			return self.ensureSchemaChangesTableExists()
			.then(function () {
				var queue = Promise.resolve();
				for(;currentVersion < sqlList.length; currentVersion++){
					console.log("looping ", currentVersion);
					queue = queue.then(function (version) {
						return function(){
							return self.runMigration(sqlList[version], version);
						};
					}(currentVersion + 1));
				}
				return queue;
			});
		})
		
	});
};

Manager.prototype.hardReset = function () {
	var self = this;
	return self.dropDatabase()
	.then(function () {
		return self.createDatabase();
	})
	.then(function () {
		return self.updateSchema();
	})
};


module.exports = Manager;