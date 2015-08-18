# pg-manager

The database schema is stored as a series of changes in a folder 'schema_updates' at the root of your project.
```
1.sql
2.sql
...etc
```

When this tool is ran, it will check a table called "schema_changes" (it will be created if needed) and run
the required sql files necessary to bring the database up to date. You can not 'downgrade' a database once it is
updated.

##Grunt
```javascript
// Gruntfile.js

var PGManager = require('pg-manager');
var pgManager = new PGManager({
	host: 'localhost',
	port: 5432,
	database: 'my-database',
	user: 'my-db-user',
	password: 'my-db-password'
});
module.exports = function(grunt) {
	grunt.registerTask('db-hard-reset', function () {
		var done = this.async();
		pgManager.hardReset()
		.then(function () {
			done();
		})
		.catch(function (err){
			grunt.log.error("Error: " + err);
			done(false);
		});
	});
	grunt.registerTask('db-update', function () {
		var done = this.async();
		pgManager.updateSchema()
		.then(function () {
			done();
		})
		.catch(function (err){
			grunt.log.error("Error: " + err);
			done(false);
		});
	});
};
```
