/*
 * downloadq.js
 *
 * Copyright (c) 2016 ALSENET SA
 *
 * Author(s):
 *
 *      Rurik Bugdanov <rurik.bugdanov@alsenet.com>
 * *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * Additional Terms:
 *
 *      You are required to preserve legal notices and author attributions in
 *      that material or in the Appropriate Legal Notices displayed by works
 *      containing it.
 *
 *      You are required to attribute the work as explained in the "Usage and
 *      Attribution" section of <http://doxel.org/license>.
 */

var followRedirects=require('follow-redirects');
var Q=require('q');
var path=require('path');
var fs=require('fs');
var microtime=require('microtime');

/**
 @function download
 @summary naive implementation of http download
 @param options {object} will be passed to resolve()
 @param options.download.url {string}
 @param options.download.dest {string} optional destination filename
 @param options.download.showProgress {boolean}
 @param options.downlaod.pipe {object} optional writeable stream
 @param options.download.inplace {boolean} do not use a temporary file
 @return promise {object} deferred promise
*/
function download(options){

  var url=options.download.url;
  var dest=options.download.dest;
  var showProgress=options.download.showProgress;
  var pipe=options.download.pipe;
  var inplace=options.download.inplace;
  var file;

  var q=Q.defer();
  var protocol=url.substr(0,url.search(':'));


  followRedirects[protocol].get(url, function(response){

    options.download.response=response;

    var q2;

    if (dest) {
      q2=Q.defer();
      var destFilename=dest+((inplace)?'':'.crdownload');

      fs.stat(destFilename,function(err,stat){
        if (err) {
          // assume destination file does not exists
          try {
            file = fs.createWriteStream(destFilename);
          } catch(e) {
            q2.reject(e);
            return;
          }

        } else {
          // TODO: destination file exists, maybe a concurrent request is
          // downloading the file (maybe in another node if using a cluster)
          // crdownload file (or a related file) should contain metadata about
          // what's going on, so that we can either restart the download,
          // pipe data and/or return the other request completion status

          // As workaround in between, set inplace to false and
          // add the current timestamp to the temporary filename
          inplace=false;
          destFilename=dest+'.'+microtime.now()+'.crdownload';
          try {
            file = fs.createWriteStream(destFilename);
          } catch(e) {
            q2.reject(e);
            return;
          }
        }
        q2.resolve();

      });

    } else {
      q2=Q.when();
    }

    q2.promise.then(function(){

//      console.log(response.headers);
      if (pipe) {
         response.pipe(pipe);
         if (!file) {
           pipe.on('finish',function(){
             q.resolve(options);
           });
         }
         pipe.on('error',function(err){
           q.reject(err);
         });
      }

      if (showProgress) {
        var ProgressBar=require('progress-stream');
        var contentLength=Number(response.headers['content-length'])||0;
        var bar=new ProgressBar('[:bar] :percent :elapsed / :etas',{total: contentLength});
        var progress=Progress({
          length: contentLength,
          time: 5000
        });
        progress.on('progress',function(progress){
            bar.tick(progress.delta);
        });
        response.pipe(progress);
      }

      if (file) {
        file.on('finish',function(){
          file.close(function(){
            if (inplace) {
              q.resolve(options);
            } else {
              fs.rename(destFilename,dest,function(err){
                if (err) {
                  q.reject(err);
                } else {
                  q.resolve(options);
                }
              });
            }
          });
        });
        file.on('error',function(err){
          q.reject(err);
        });
        response.pipe(file);
      }

    })
    .fail(q.reject)
    .done();

  }).on('error', function(err){
    q.reject(err);
  });

  return q.promise;
}

/**
@function startQueue
@summary start download queue
@param queue {object} array of download options (see function download above)
@return promise {object] deferred promise
*/
function startQueue(queue) {
  var q=Q.defer();
  processQueueElem(queue,q);
  return q.promise;
}

/**
 @function processQueueElem
 @param queue {Array}
 @param q {Object} deferred promise
 @return undefined
 */
function processQueueElem(queue,q){
  if (queue.length==0) {
    console.log('queue empty');
    q.resolve();
    return;
  }
  var url=queue[0].url;
  var basename=path.basename(url);
  var dest=queue[0].dest;
  fs.exists(dest,function(exists){
    if (exists) {
      console.log('Cached: ',url);
      if (queue[0].pipe) {
        fs.createReadStream(dest).pipe(pipe);
      }
      if (queue[0].callback) {
        callback();
      }
      queue.shift();
      process.nextTick(function(){
        processQueueElem(queue,q);
      });
      return;
    }
    console.log('Downloading: ', url);
    download({download:queue[0]})
    .then(function(){
      console.log('Download successful: ',url);
      if (queue[0].callback) {
        callback(queue[0]).then(function(){
          queue.shift();
          processNextQueueElem(queue,q);
        }).fail(q.reject);
      }
      queue.shift();
      process.nextTick(function(){
        processQueueElem(queue,q);
      });
    })
    .fail(q.reject)
    .done();
  });
} // processQueueElem


module.exports={
  download: download,
  startQueue: startQueue,
  processQueueElem: processQueueElem
};
