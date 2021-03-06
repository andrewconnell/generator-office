'use strict';

var generators = require('yeoman-generator');
var chalk = require('chalk');
var path = require('path');
var _ = require('lodash');
var extend = require('deep-extend');
var guid = require('uuid');
var Xml2Js = require('xml2js');

module.exports = generators.Base.extend({
  /**
   * Setup the generator
   */
  constructor: function(){
    generators.Base.apply(this, arguments);

    this.option('skip-install', {
      type: Boolean,
      required: false,
      defaults: false,
      desc: 'Skip running package managers (NPM, bower, etc) post scaffolding'
    });

    this.option('name', {
      type: String,
      desc: 'Title of the Office Add-in',
      required: false
    });

    this.option('root-path', {
      type: String,
      desc: 'Relative path where the Add-in should be created (blank = current directory)',
      required: false
    });

    this.option('tech', {
      type: String,
      desc: 'Technology to use for the Add-in (html = HTML; ng = Angular)',
      required: false
    });

    this.option('outlookForm', {
      type: String,
      desc: 'Supported Outlook forms',
      required: false
    });
    
    this.option('appId', {
      type: String,
      desc: 'Application ID as registered in Azure AD',
      required: false
    });

    // create global config object on this generator
    this.genConfig = {};
  }, // constructor()

  /**
   * Prompt users for options
   */
  prompting: {

    askFor: function(){
      var done = this.async();

      var prompts = [
        // friendly name of the generator
        {
          name: 'name',
          message: 'Project name (display name):',
          default: 'My Office Add-in',
          when: this.options.name === undefined
        },
        // root path where the addin should be created; should go in current folder where
        //  generator is being executed, or within a subfolder?
        {
          name: 'root-path',
          message: 'Root folder of project?'
          + ' Default to current directory\n (' + this.destinationRoot() + '), or specify relative path\n'
          + '  from current (src / public): ',
          default: 'current folder',
          when: this.options['root-path'] === undefined,
          filter: /* istanbul ignore next */ function(response){
            if (response === 'current folder'){
              return '';
            } else {
              return response;
            }
          }
        },
        // technology used to create the addin (html / angular / etc)
        {
          name: 'tech',
          message: 'Technology to use:',
          type: 'list',
          when: this.options.tech === undefined,
          choices: [
            {
              name: 'HTML, CSS & JavaScript',
              value: 'html'
            }, {
              name: 'Angular',
              value: 'ng'
            }, {
              name: 'Angular ADAL',
              value: 'ng-adal'
            }, {
              name: 'Manifest.xml only (no application source files)',
              value: 'manifest-only'
            }]
        },
        {
          name: 'outlookForm',
          message: 'Supported Outlook forms:',
          type: 'checkbox',
          choices: [
            {
              name: 'E-Mail message - read form',
              value: 'mail-read',
              checked: true
            },
            {
              name: 'E-Mail message - compose form',
              value: 'mail-compose',
              checked: true
            },
            {
              name: 'Appointment - read form',
              value: 'appointment-read',
              checked: true
            },
            {
              name: 'Appointment - compose form',
              value: 'appointment-compose',
              checked: true
            }
          ],
          when: this.options.outlookForm === undefined,
          validate: /* istanbul ignore next */ function(answers){
            if (answers.length < 1) {
              return 'Must select at least one Outlook form type';
            }
            return true;
          }
        }];

      // trigger prompts
      this.prompt(prompts, function(responses){
        this.genConfig = extend(this.genConfig, this.options);
        this.genConfig = extend(this.genConfig, responses);
        done();
      }.bind(this));

    }, // askFor()
    
    askForAdalConfig: function(){
      // if it's not an ADAL app, don't ask the questions
      if (this.genConfig.tech !== 'ng-adal') {
        return;
      }

      var done = this.async();

      // office client application that can host the addin
      var prompts = [{
        name: 'appId',
        message: 'Application ID as registered in Azure AD:',
        default: '00000000-0000-0000-0000-000000000000',
        when: this.options.appId === undefined
      }];

      // trigger prompts
      this.prompt(prompts, function(responses){
        this.genConfig = extend(this.genConfig, responses);
        done();
      }.bind(this));

    }, // askForAdalConfig()

    /**
     * If user specified tech:manifest-only, prompt for start page.
     */
    askForStartPage: function(){
      if (this.genConfig.tech !== 'manifest-only'){
        return;
      }

      var done = this.async();

      var prompts = [
        // if tech = manifest only, prompt for start page
        {
          name: 'startPage',
          message: 'Add-in start URL:',
          when: this.options.startPage === undefined,
        }];

      // trigger prompts
      this.prompt(prompts, function(responses){
        this.genConfig = extend(this.genConfig, responses);
        done();
      }.bind(this));

    } // askForStartPage()


  }, // prompting()

  /**
   * save configurations & config project
   */
  configuring: function(){
    // take name submitted and strip everything out non-alphanumeric or space
    var projectName = this.genConfig.name;
    projectName = projectName.replace(/[^\w\s\-]/g, '');
    projectName = projectName.replace(/\s{2,}/g, ' ');
    projectName = projectName.trim();

    // add the result of the question to the generator configuration object
    this.genConfig.projectInternalName = projectName.toLowerCase().replace(/ /g, '-');
    this.genConfig.projectDisplayName = projectName;
    this.genConfig.rootPath = this.genConfig['root-path'];
  }, // configuring()

  /**
   * write generator specific files
   */
  writing: {
    /**
     * If there is already a package.json in the root of this project,
     * get the name of the project from that file as that should be used
     * in bower.json & update packages.
     */
    upsertPackage: function(){
      if (this.genConfig.tech !== 'manifest-only') {
        var done = this.async();

        // default name for the root project = addin project
        this.genConfig.rootProjectName = this.genConfig.projectInternalName;

        // path to package.json
        var pathToPackageJson = this.destinationPath('package.json');

        // if package.json doesn't exist
        if (!this.fs.exists(pathToPackageJson)) {
          // copy package.json to target
          this.fs.copyTpl(this.templatePath('common/_package.json'),
            this.destinationPath('package.json'),
            this.genConfig);
        } else {
          // load package.json
          var packageJson = this.fs.readJSON(pathToPackageJson, 'utf8');

          // .. get it's name property
          this.genConfig.rootProjectName = packageJson.name;

          // update devDependencies
          /* istanbul ignore else */
          if (!packageJson.devDependencies) {
            packageJson.devDependencies = {};
          }
          /* istanbul ignore else */
          if (!packageJson.devDependencies['chalk']) {
            packageJson.devDependencies['chalk'] = '^1.1.1';
          }
          /* istanbul ignore else */
          if (!packageJson.devDependencies['gulp']) {
            packageJson.devDependencies['gulp'] = '^3.9.0';
          }
          /* istanbul ignore else */
          if (!packageJson.devDependencies['gulp-webserver']) {
            packageJson.devDependencies['gulp-webserver'] = '^0.9.1';
          }
          /* istanbul ignore else */
          if (!packageJson.devDependencies['minimist']) {
            packageJson.devDependencies['minimist'] = '^1.2.0';
          }
          /* istanbul ignore else */
          if (!packageJson.devDependencies['xmllint']) {
            packageJson.devDependencies['xmllint'] = 'git+https://github.com/kripken/xml.js.git';
          }

          // overwrite existing package.json
          this.log(chalk.yellow('Adding additional packages to package.json'));
          this.fs.writeJSON(pathToPackageJson, packageJson);
        }

        done();
      }
    }, // upsertPackage()

    /**
     * If bower.json already exists in the root of this project, update it
     * with the necessary addin packages.
     */
    upsertBower: function(){
      if (this.genConfig.tech !== 'manifest-only') {
        /**
         * Copies bower.json from appropriate template => target.
         *
         * @param {Object} yoGenerator - Yeoman generator.
         * @param {string} addinTech - Technology to use for the addin.
         */
        this._copyBower = function(yoGenerator, addinTech){
          switch (addinTech) {
            case 'ng':
              yoGenerator.fs.copyTpl(yoGenerator.templatePath('ng/_bower.json'),
                yoGenerator.destinationPath('bower.json'),
                yoGenerator.genConfig);
              break;
            case 'ng-adal':
              yoGenerator.fs.copyTpl(yoGenerator.templatePath('ng-adal/_bower.json'),
                yoGenerator.destinationPath('bower.json'),
                yoGenerator.genConfig);
              break;
            case 'html':
              yoGenerator.fs.copyTpl(yoGenerator.templatePath('html/_bower.json'),
                yoGenerator.destinationPath('bower.json'),
                yoGenerator.genConfig);
              break;
          }
        };

        /**
         * Update existing bower.json with the necessary references.
         *
         * @param {Object} yoGenerator - Yeoman generator.
         * @param {string} addinTech - Technology to use for the addin.
         */
        this._updateBower = function(yoGenerator, addinTech){
          // verify the necessary package references are present in bower.json...
          //  if not, add them
          var bowerJson = yoGenerator.fs.readJSON(pathToBowerJson, 'utf8');

          // all addins need these
          /* istanbul ignore else */
          if (!bowerJson.dependencies['microsoft.office.js']) {
            bowerJson.dependencies['microsoft.office.js'] = '*';
          }

          switch (addinTech) {
            case 'html':
              /* istanbul ignore else */
              if (!bowerJson.dependencies['jquery']) {
                bowerJson.dependencies['jquery'] = '~1.9.1';
              }
              break;
            // if angular...
            case 'ng':
              /* istanbul ignore else */
              if (!bowerJson.dependencies['angular']) {
                bowerJson.dependencies['angular'] = '~1.4.4';
              }
              /* istanbul ignore else */
              if (!bowerJson.dependencies['angular-route']) {
                bowerJson.dependencies['angular-route'] = '~1.4.4';
              }
              /* istanbul ignore else */
              if (!bowerJson.dependencies['angular-sanitize']) {
                bowerJson.dependencies['angular-sanitize'] = '~1.4.4';
              }
              break;
            case 'ng-adal':
              /* istanbul ignore else */
              if (!bowerJson.dependencies['angular']) {
                bowerJson.dependencies['angular'] = '~1.4.4';
              }
              /* istanbul ignore else */
              if (!bowerJson.dependencies['angular-route']) {
                bowerJson.dependencies['angular-route'] = '~1.4.4';
              }
              /* istanbul ignore else */
              if (!bowerJson.dependencies['angular-sanitize']) {
                bowerJson.dependencies['angular-sanitize'] = '~1.4.4';
              }
              /* istanbul ignore else */
              if (!bowerJson.dependencies['adal-angular']) {
                bowerJson.dependencies['adal-angular'] = '~1.0.5';
              }
              break;
          }

          // overwrite existing bower.json
          yoGenerator.log(chalk.yellow('Adding additional packages to bower.json'));
          yoGenerator.fs.writeJSON(pathToBowerJson, bowerJson);
        };

        // workaround to 'this' context issue
        var yoGenerator = this;

        var done = this.async();

        var pathToBowerJson = this.destinationPath('bower.json');
        // if doesn't exist...
        if (!this.fs.exists(pathToBowerJson)) {
          // copy bower.json => project
          this._copyBower(yoGenerator, yoGenerator.genConfig.tech);
        } else {
          // update bower.json => project
          this._updateBower(yoGenerator, yoGenerator.genConfig.tech);
        }

        done();
      }
    }, // upsertBower()

    /**
     * If tsd.json already exists in the root of this project, update it
     * with the necessary addin packages.
     */
    upsertTsd: function(){
      if (this.genConfig.tech !== 'manifest-only') {
        /**
         * Copies tsd.json from appropriate template => target.
         *
         * @param {Object} yoGenerator - Yeoman generator.
         * @param {string} addinTech - Technology to use for the addin.
         */
        this._copyTsd = function(yoGenerator, addinTech){
          switch (addinTech) {
            case 'ng':
              this.fs.copyTpl(this.templatePath('ng/_tsd.json'),
                this.destinationPath('tsd.json'),
                this.genConfig);
              break;
            case 'ng-adal':
              this.fs.copyTpl(this.templatePath('ng-adal/_tsd.json'),
                this.destinationPath('tsd.json'),
                this.genConfig);
              break;
            case 'html':
              this.fs.copyTpl(this.templatePath('html/_tsd.json'),
                this.destinationPath('tsd.json'),
                this.genConfig);
              break;
          }
        };

        /**
         * Update existing tsd.json with the necessary references.
         *
         * @param {Object} yoGenerator - Yeoman generator.
         * @param {string} addinTech - Technology to use for the addin.
         */
        this._updateTsd = function(yoGenerator, addinTech){
          // verify the necessary package references are present in tsd.json...
          //  if not, add them
          var tsdJson = yoGenerator.fs.readJSON(pathToTsdJson, 'utf8');

          // all addins need these
          /* istanbul ignore else */
          if (!tsdJson.installed['office-js/office-js.d.ts']) {
            tsdJson.installed['office-js/office-js.d.ts'] = {
              'commit': '62eedc3121a5e28c50473d2e4a9cefbcb9c3957f'
            };
          }

          switch (addinTech) {
            case 'html':
              /* istanbul ignore else */
              if (!tsdJson.installed['jquery/jquery.d.ts']) {
                tsdJson.installed['jquery/jquery.d.ts'] = {
                  'commit': '04a025ada3492a22df24ca2d8521c911697721b3'
                };
              }
              break;
            // if angular...
            case 'ng':
              // angular & ng-angular are the same as there is no typedef for adal-angular
            case 'ng-adal':
              /* istanbul ignore else */
              if (!tsdJson.installed['angularjs/angular.d.ts']) {
                tsdJson.installed['angularjs/angular.d.ts'] = {
                  'commit': '04a025ada3492a22df24ca2d8521c911697721b3'
                };
              }
              /* istanbul ignore else */
              if (!tsdJson.installed['angularjs/angular-route.d.ts']) {
                tsdJson.installed['angularjs/angular-route.d.ts'] = {
                  'commit': '04a025ada3492a22df24ca2d8521c911697721b3'
                };
              }
              /* istanbul ignore else */
              if (!tsdJson.installed['angularjs/angular-sanitize.d.ts']) {
                tsdJson.installed['angularjs/angular-sanitize.d.ts'] = {
                  'commit': '04a025ada3492a22df24ca2d8521c911697721b3'
                };
              }
              break;
          }

          // overwrite existing bower.json
          yoGenerator.log(chalk.yellow('Adding additional packages to tsd.json'));
          yoGenerator.fs.writeJSON(pathToTsdJson, tsdJson);
        };

        // workaround to 'this' context issue
        var yoGenerator = this;

        var done = yoGenerator.async();

        var pathToTsdJson = yoGenerator.destinationPath('tsd.json');
        // if doesn't exist...
        if (!yoGenerator.fs.exists(pathToTsdJson)) {
          // copy tsd.json => project
          this._copyTsd(yoGenerator, yoGenerator.genConfig.tech);
        } else {
          // update tsd.json => project
          this._updateTsd(yoGenerator, yoGenerator.genConfig.tech);
        }

        done();
      }
    }, // upsertTsd()

    app: function(){
      // helper function to build path to the file off root path
      this._parseTargetPath = function(file){
        return path.join(this.genConfig['root-path'], file);
      };

      var done = this.async();

      // manifest filename
      var manifestFilename = 'manifest-' + this.genConfig.projectInternalName + '.xml';

      // create a new ID for the project
      this.genConfig.projectId = guid.v4();

      if (this.genConfig.tech === 'manifest-only') {
        // set start page same for both forms
        this.genConfig.startPageReadForm = this.genConfig.startPage;
        this.genConfig.startPageEditForm = this.genConfig.startPage;
        // create the manifest file
        this.fs.copyTpl(this.templatePath('common/manifest.xml'),
                        this.destinationPath(manifestFilename),
                        this.genConfig);
      } else {
        // copy .bowerrc => project
        this.fs.copyTpl(this.templatePath('common/_bowerrc'),
                        this.destinationPath('.bowerrc'),
                        this.genConfig);

        // create common assets
        this.fs.copy(this.templatePath('common/gulpfile.js'),
                     this.destinationPath('gulpfile.js'));
        this.fs.copy(this.templatePath('common/content/Office.css'),
                     this.destinationPath(this._parseTargetPath('content/Office.css')));
        this.fs.copy(this.templatePath('common/images/close.png'),
                     this.destinationPath(this._parseTargetPath('images/close.png')));
        this.fs.copy(this.templatePath('common/scripts/MicrosoftAjax.js'),
                     this.destinationPath(this._parseTargetPath('scripts/MicrosoftAjax.js')));

        switch (this.genConfig.tech) {
          case 'html':
            // determine startpage for addin
            this.genConfig.startPageReadForm = 'https://localhost:8443/appread/home/home.html';
            this.genConfig.startPageEditForm = 'https://localhost:8443/appcompose/home/home.html';

            // copy jsconfig files
            this.fs.copy(this.templatePath('common/_jsconfig.json'),
                         this.destinationPath('jsconfig.json'));

            // copy tsconfig files
            this.fs.copy(this.templatePath('common/_tsconfig.json'),
                         this.destinationPath('tsconfig.json'));

            // create the manifest file
            this.fs.copyTpl(this.templatePath('common/manifest.xml'),
                            this.destinationPath(manifestFilename),
                            this.genConfig);
            this.fs.copy(this.templatePath('common/manifest.xsd'),
                         this.destinationPath('manifest.xsd'));

            // copy addin files
            if (this.genConfig.outlookForm &&
                (this.genConfig.outlookForm.indexOf('mail-compose') > -1 ||
                this.genConfig.outlookForm.indexOf('appointment-compose') > -1)) {
              this.fs.copy(this.templatePath('html/appcompose/app.css'),
                          this.destinationPath(this._parseTargetPath('appcompose/app.css')));
              this.fs.copy(this.templatePath('html/appcompose/app.js'),
                          this.destinationPath(this._parseTargetPath('appcompose/app.js')));
              this.fs.copy(this.templatePath('html/appcompose/home/home.html'),
                          this.destinationPath(this._parseTargetPath('appcompose/home/home.html')));
              this.fs.copy(this.templatePath('html/appcompose/home/home.css'),
                          this.destinationPath(this._parseTargetPath('appcompose/home/home.css')));
              this.fs.copy(this.templatePath('html/appcompose/home/home.js'),
                          this.destinationPath(this._parseTargetPath('appcompose/home/home.js')));
            }

            if (this.genConfig.outlookForm &&
                (this.genConfig.outlookForm.indexOf('mail-read') > -1 ||
                this.genConfig.outlookForm.indexOf('appointment-read') > -1)) {
              this.fs.copy(this.templatePath('html/appread/app.css'),
                          this.destinationPath(this._parseTargetPath('appread/app.css')));
              this.fs.copy(this.templatePath('html/appread/app.js'),
                          this.destinationPath(this._parseTargetPath('appread/app.js')));
              this.fs.copy(this.templatePath('html/appread/home/home.html'),
                          this.destinationPath(this._parseTargetPath('appread/home/home.html')));
              this.fs.copy(this.templatePath('html/appread/home/home.css'),
                          this.destinationPath(this._parseTargetPath('appread/home/home.css')));
              this.fs.copy(this.templatePath('html/appread/home/home.js'),
                          this.destinationPath(this._parseTargetPath('appread/home/home.js')));
            }
            break;
          case 'ng':
            // determine startpage for addin
            this.genConfig.startPageReadForm = 'https://localhost:8443/appread/index.html';
            this.genConfig.startPageEditForm = 'https://localhost:8443/appcompose/index.html';

            // copy jsconfig files
            this.fs.copy(this.templatePath('common/_jsconfig.json'),
                         this.destinationPath('jsconfig.json'));

            // copy tsconfig files
            this.fs.copy(this.templatePath('common/_tsconfig.json'),
                         this.destinationPath('tsconfig.json'));

            // create the manifest file
            this.fs.copyTpl(this.templatePath('common/manifest.xml'),
                            this.destinationPath(manifestFilename),
                            this.genConfig);
            this.fs.copy(this.templatePath('common/manifest.xsd'),
                         this.destinationPath('manifest.xsd'));

            // copy addin files
            this.genConfig.startPage = '{https-addin-host-site}/index.html';
            if (this.genConfig.outlookForm &&
                (this.genConfig.outlookForm.indexOf('mail-compose') > -1 ||
                this.genConfig.outlookForm.indexOf('appointment-compose') > -1)) {
              this.fs.copy(this.templatePath('ng/appcompose/index.html'),
                          this.destinationPath(this._parseTargetPath('appcompose/index.html')));
              this.fs.copy(this.templatePath('ng/appcompose/app.module.js'),
                          this.destinationPath(this._parseTargetPath('appcompose/app.module.js')));
              this.fs.copy(this.templatePath('ng/appcompose/app.routes.js'),
                          this.destinationPath(this._parseTargetPath('appcompose/app.routes.js')));
              this.fs.copy(this.templatePath('ng/appcompose/home/home.controller.js'),
                          this.destinationPath(this._parseTargetPath('appcompose/home/home.controller.js')));
              this.fs.copy(this.templatePath('ng/appcompose/home/home.html'),
                          this.destinationPath(this._parseTargetPath('appcompose/home/home.html')));
              this.fs.copy(this.templatePath('ng/appcompose/services/data.service.js'),
                          this.destinationPath(this._parseTargetPath('appcompose/services/data.service.js')));
            }

            if (this.genConfig.outlookForm &&
                (this.genConfig.outlookForm.indexOf('mail-read') > -1 ||
                this.genConfig.outlookForm.indexOf('appointment-read') > -1)) {
              this.fs.copy(this.templatePath('ng/appread/index.html'),
                          this.destinationPath(this._parseTargetPath('appread/index.html')));
              this.fs.copy(this.templatePath('ng/appread/app.module.js'),
                          this.destinationPath(this._parseTargetPath('appread/app.module.js')));
              this.fs.copy(this.templatePath('ng/appread/app.routes.js'),
                          this.destinationPath(this._parseTargetPath('appread/app.routes.js')));
              this.fs.copy(this.templatePath('ng/appread/home/home.controller.js'),
                          this.destinationPath(this._parseTargetPath('appread/home/home.controller.js')));
              this.fs.copy(this.templatePath('ng/appread/home/home.html'),
                          this.destinationPath(this._parseTargetPath('appread/home/home.html')));
              this.fs.copy(this.templatePath('ng/appread/services/data.service.js'),
                          this.destinationPath(this._parseTargetPath('appread/services/data.service.js')));
            }
            break;
          case 'ng-adal':
            // determine startpage for addin
            this.genConfig.startPageReadForm = 'https://localhost:8443/appread/index.html';
            this.genConfig.startPageEditForm = 'https://localhost:8443/appcompose/index.html';

            // copy jsconfig files
            this.fs.copy(this.templatePath('common/_jsconfig.json'),
                         this.destinationPath('jsconfig.json'));

            // copy tsconfig files
            this.fs.copy(this.templatePath('common/_tsconfig.json'),
                         this.destinationPath('tsconfig.json'));

            // create the manifest file
            this.fs.copyTpl(this.templatePath('ng-adal/manifest.xml'),
                            this.destinationPath(manifestFilename),
                            this.genConfig);
            this.fs.copy(this.templatePath('common/manifest.xsd'),
                         this.destinationPath('manifest.xsd'));

            // copy addin files
            this.genConfig.startPage = '{https-addin-host-site}/index.html';
            if (this.genConfig.outlookForm &&
                (this.genConfig.outlookForm.indexOf('mail-compose') > -1 ||
                this.genConfig.outlookForm.indexOf('appointment-compose') > -1)) {
              this.fs.copy(this.templatePath('ng-adal/appcompose/index.html'),
                          this.destinationPath(this._parseTargetPath('appcompose/index.html')));
              this.fs.copy(this.templatePath('ng-adal/appcompose/app.module.js'),
                          this.destinationPath(this._parseTargetPath('appcompose/app.module.js')));
              this.fs.copy(this.templatePath('ng-adal/appcompose/app.adalconfig.js'),
                          this.destinationPath(this._parseTargetPath('appcompose/app.adalconfig.js')));
              this.fs.copyTpl(this.templatePath('ng-adal/appcompose/app.config.js'),
                          this.destinationPath(this._parseTargetPath('appcompose/app.config.js')),
                          this.genConfig);
              this.fs.copy(this.templatePath('ng-adal/appcompose/app.routes.js'),
                          this.destinationPath(this._parseTargetPath('appcompose/app.routes.js')));
              this.fs.copy(this.templatePath('ng-adal/appcompose/home/home.controller.js'),
                          this.destinationPath(this._parseTargetPath('appcompose/home/home.controller.js')));
              this.fs.copy(this.templatePath('ng-adal/appcompose/home/home.html'),
                          this.destinationPath(this._parseTargetPath('appcompose/home/home.html')));
              this.fs.copy(this.templatePath('ng-adal/appcompose/services/data.service.js'),
                          this.destinationPath(this._parseTargetPath('appcompose/services/data.service.js')));
            }

            if (this.genConfig.outlookForm &&
                (this.genConfig.outlookForm.indexOf('mail-read') > -1 ||
                this.genConfig.outlookForm.indexOf('appointment-read') > -1)) {
              this.fs.copy(this.templatePath('ng-adal/appread/index.html'),
                          this.destinationPath(this._parseTargetPath('appread/index.html')));
              this.fs.copy(this.templatePath('ng-adal/appread/app.module.js'),
                          this.destinationPath(this._parseTargetPath('appread/app.module.js')));
              this.fs.copy(this.templatePath('ng-adal/appread/app.adalconfig.js'),
                          this.destinationPath(this._parseTargetPath('appread/app.adalconfig.js')));
              this.fs.copyTpl(this.templatePath('ng-adal/appread/app.config.js'),
                          this.destinationPath(this._parseTargetPath('appread/app.config.js')),
                          this.genConfig);
              this.fs.copy(this.templatePath('ng-adal/appread/app.routes.js'),
                          this.destinationPath(this._parseTargetPath('appread/app.routes.js')));
              this.fs.copy(this.templatePath('ng-adal/appread/home/home.controller.js'),
                          this.destinationPath(this._parseTargetPath('appread/home/home.controller.js')));
              this.fs.copy(this.templatePath('ng-adal/appread/home/home.html'),
                          this.destinationPath(this._parseTargetPath('appread/home/home.html')));
              this.fs.copy(this.templatePath('ng-adal/appread/services/data.service.js'),
                          this.destinationPath(this._parseTargetPath('appread/services/data.service.js')));
            }
            break;
        }
      }

      done();
    }, // app()

    /**
     * Update the manifest.xml to reflect the selected
     * Outlook client forms supported by this addin.
     */
    updateManifestForms: function(){
      var done = this.async();

      // manifest filename
      var manifestFilename = 'manifest-' + this.genConfig.projectInternalName + '.xml';

      // workaround to 'this' context issue
      var yoGenerator = this;

      // load manifest.xml
      var manifestXml = yoGenerator.fs.read(yoGenerator.destinationPath(manifestFilename));

      // convert it to JSON
      var parser = new Xml2Js.Parser();
      parser.parseString(manifestXml, function(err, manifestJson){

        // if mail/appointment read not present, remove the form setting
        _.remove(manifestJson.OfficeApp.FormSettings[0].Form, function(formSetting){
          if (formSetting.$['xsi:type'] === 'ItemRead' &&
            yoGenerator.genConfig.outlookForm &&
            yoGenerator.genConfig.outlookForm.indexOf('mail-read') < 0 &&
            yoGenerator.genConfig.outlookForm.indexOf('appointment-read') < 0) {
            return true;
          } else {
            return false;
          }
        });

        // if mail/appointment edit not present, remove the form setting
        _.remove(manifestJson.OfficeApp.FormSettings[0].Form, function(formSetting){
          if (formSetting.$['xsi:type'] === 'ItemEdit' &&
            yoGenerator.genConfig.outlookForm &&
            yoGenerator.genConfig.outlookForm.indexOf('mail-compose') < 0 &&
            yoGenerator.genConfig.outlookForm.indexOf('appointment-compose') < 0) {
            return true;
          } else {
            return false;
          }
        });

        // create array of selected form types
        var supportedFormTypesJson = [];
        _.forEach(yoGenerator.genConfig.outlookForm, function(formType){
          switch (formType) {
            case 'mail-read':
              supportedFormTypesJson.push({
                '$': {
                  'xsi:type': 'ItemIs',
                  ItemType: 'Message',
                  FormType: 'Read'
                }
              });
              break;
            case 'mail-compose':
              supportedFormTypesJson.push({
                '$': {
                  'xsi:type': 'ItemIs',
                  ItemType: 'Message',
                  FormType: 'Edit'
                }
              });
              break;
            case 'appointment-read':
              supportedFormTypesJson.push({
                '$': {
                  'xsi:type': 'ItemIs',
                  ItemType: 'Appointment',
                  FormType: 'Read'
                }
              });
              break;
            case 'appointment-compose':
              supportedFormTypesJson.push({
                '$': {
                  'xsi:type': 'ItemIs',
                  ItemType: 'Appointment',
                  FormType: 'Edit'
                }
              });
              break;
          }
        });

        var ruleEntry;
        // if only one rule, add it
        if (supportedFormTypesJson.length === 1) {
          ruleEntry = supportedFormTypesJson[0];
        } else {
          // create container of rules & ad it
          ruleEntry = {
            '$': {
              'xsi:type': 'RuleCollection',
              Mode: 'Or',
            },
            Rule: supportedFormTypesJson
          };
        }
        // add the rule to the manifest
        manifestJson.OfficeApp.Rule[0] = ruleEntry;

        // convert JSON => XML
        var xmlBuilder = new Xml2Js.Builder();
        var updatedManifestXml = xmlBuilder.buildObject(manifestJson);

        // write updated manifest
        yoGenerator.fs.write(yoGenerator.destinationPath(manifestFilename), updatedManifestXml);

        done();
      });

    } // updateManifestForms()
  }, // writing()

  /**
   * conflict resolution
   */
  // conflicts: { },

  /**
   * run installations (bower, npm, tsd, etc)
   */
  install: function(){

    if (!this.options['skip-install'] && this.genConfig.tech !== 'manifest-only') {
      this.npmInstall();
    }

  } // install ()

  /**
   * last cleanup, goodbye, etc
   */
  // end: { }


});
