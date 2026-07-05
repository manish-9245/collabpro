import {v} from 'convex/values';
import { mutation, query } from './_generated/server';

export const createFile=mutation({
    args:{
        fileName:v.string(),
        teamId:v.string(),
        createdBy:v.string(),
        archive:v.boolean(),
        document:v.string(),
        whiteboard:v.string(),
        folder:v.optional(v.string())
    },
    handler:async(ctx, args) =>{
        const result=await ctx.db.insert('files',args as any);
        return result;
    },
})

export const getFiles=query({
    args:{
        teamId:v.string(),
        userEmail:v.optional(v.string()),
        scope:v.optional(v.string())
    },
    handler:async(ctx, args)=> {
        let result;
        if (args.scope === 'personal' && args.userEmail) {
            result = await ctx.db.query('files')
            .filter(q => q.and(
                q.eq(q.field('teamId'), args.teamId),
                q.eq(q.field('createdBy'), args.userEmail)
            ))
            .order('desc')
            .collect();
        } else {
            result = await ctx.db.query('files')
            .filter(q => q.eq(q.field('teamId'), args.teamId))
            .order('desc')
            .collect();
        }
        return result;
    },
})

export const updateDocument=mutation({
    args:{
        _id:v.id('files'),
        document:v.string()
    },
    handler:async(ctx, args) =>{
        const result =await ctx.db.patch(args._id,{document:args.document});
        return result;
    },
})

export const updateWhiteboard=mutation({
    args:{
        _id:v.id('files'),
        whiteboard:v.string()
    },
    handler:async(ctx, args) =>{
        const result =await ctx.db.patch(args._id,{whiteboard:args.whiteboard});
        return result;
    },
})



export const getFileById=query({
    args:{
        _id:v.id('files')
    },
    handler:async(ctx, args)=> {
        const result=await ctx.db.get(args._id);
        return result;
    },
})

export const updateFileName=mutation({
    args:{
        _id:v.id('files'),
        fileName:v.string()
    },
    handler:async(ctx, args) =>{
        const result =await ctx.db.patch(args._id,{fileName:args.fileName});
        return result;
    },
})

export const archiveFile=mutation({
    args:{
        _id:v.id('files'),
        archive:v.boolean()
    },
    handler:async(ctx, args) =>{
        const result =await ctx.db.patch(args._id,{archive:args.archive});
        return result;
    },
})

export const deleteFile=mutation({
    args:{
        _id:v.id('files')
    },
    handler:async(ctx, args) =>{
        const result =await ctx.db.delete(args._id);
        return result;
    },
})

export const updateFileFolder=mutation({
    args:{
        _id:v.id('files'),
        folder:v.optional(v.string())
    },
    handler:async(ctx, args) =>{
        const result =await ctx.db.patch(args._id,{folder:args.folder} as any);
        return result;
    },
})