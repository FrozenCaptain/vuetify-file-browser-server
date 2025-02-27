const nodePath = require("path"),
    AWS = require("aws-sdk");
const urlCacheList = [];
class S3Storage {
    constructor(accessKeyId, secretKey, region, bucket, rootPath,endpoint = null) {
        this.code = "s3";
        this.bucket = bucket;
       
        const S3Endpoint = endpoint !== null ? new AWS.Endpoint(endpoint) : null;
        if( S3Endpoint !== null){
            this.S3 = new AWS.S3({
                endpoint: S3Endpoint,
                accessKeyId: accessKeyId,
                secretAccessKey: secretKey,
                params: { Bucket: bucket }
            });
        }else{
            this.S3 = new AWS.S3({
                region: region,
                accessKeyId: accessKeyId,
                secretAccessKey: secretKey,
                params: { Bucket: bucket }
            });
        }


        // this.S3 = new AWS.S3({
        //     apiVersion: "2006-03-01",
        //     params: { Bucket: bucket }
        // });

        if (rootPath && rootPath[0] === "/") {
            rootPath = rootPath.slice(1);
        }

        if (rootPath && rootPath[rootPath.length - 1] !== "/") {
            rootPath += "/";
        }

        this.rootPath = rootPath;
    }

    async list(path) {
        try {
            let dirs = [],
                files = [];

            let data = await this.S3.listObjectsV2({
                Delimiter: "/",
                Prefix: this.rootPath + path.slice(1)
            }).promise();

            for (let prefix of data.CommonPrefixes) {
                let dir = {
                    type: "dir",
                    path: "/" + prefix.Prefix.slice(this.rootPath.length)
                };
                dir.basename = dir.name = nodePath.basename(dir.path);
                dirs.push(dir);
            }

            for (let item of data.Contents.filter(item => item.Key != data.Prefix)) {
                let file = {
                    type: "file",
                    path: "/" + item.Key.slice(this.rootPath.length),
                    size: item.Size,
                    lastModified: item.LastModified,
                    eTag: item.ETag
                };
                file.basename = nodePath.basename(file.path);
                file.extension = nodePath.extname(file.path).slice(1);
                file.name = nodePath.basename(file.path, "." + file.extension);
                files.push(file);
            }
            return dirs.concat(files);

        } catch (err) {
            console.error(err);
        }
    }
    async view(path){
        const cachedUrl = urlCacheList.find(item => item.path === path)
        if(cachedUrl !== null && cachedUrl !== undefined && new Date(cachedUrl.expire) > new Date().getTime()){
            return cachedUrl;
        }
        const olddate = new Date
        const expireDate = new Date(olddate.getTime() + 30*60000);
        const expireSeconds = 60 * 30; // 30 minutes
        const url = await this.S3.getSignedUrl('getObject', {
            Bucket: this.bucket,
            Key:    path.substring(1),
            Expires: expireSeconds
        });
        urlCacheList.push({url:url,expire:expireDate,path:path});
        return {url:url,expire:expireDate,path:path};
    }
    async upload(path, files) {
        try {
            const fs = require("fs");
            path = this.rootPath + path.slice(1);

            for (let file of files) {
                var fileStream = fs.createReadStream(file.path);
                await this.S3.upload({
                    Key: path + file.originalname,
                    Body: fileStream
                }).promise();
            }
        } catch (err) {
            console.error(err);
        }
    }

    async mkdir(path) {
        path = this.rootPath + path.slice(1) + "/";
        await this.S3.upload({
            Key: path,
            Body: ""
        }).promise();
    }

    async deleteFile(key) {
        await this.S3.deleteObject({ Key: this.rootPath + key }).promise();
    }

    async deleteDir(prefix) {
        const listedObjects = await this.S3.listObjectsV2({
            Prefix: this.rootPath + prefix
        }).promise();

        if (listedObjects.Contents.length === 0) {
            return;
        }

        const deleteParams = {
            Delete: { Objects: [] }
        };

        listedObjects.Contents.forEach(({ Key }) => {
            deleteParams.Delete.Objects.push({ Key });
        });

        await this.S3.deleteObjects(deleteParams).promise();

        if (listedObjects.IsTruncated) {
            await this.deleteDir(prefix);
        }
    }

    async delete(path) {
        try {
            path = path.slice(1);
            if (path[path.length - 1] == "/") {
                await this.deleteDir(path);
            } else {
                await this.deleteFile(path);
            }
        } catch (err) {
            console.error(err);
        }
    }
}

module.exports = S3Storage;