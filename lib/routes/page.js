module.exports = function(crowi, app) {
  'use strict';

  var debug = require('debug')('crowi:routes:page')
    , Page = crowi.model('Page')
    , User = crowi.model('User')
    , Revision = crowi.model('Revision')
    , Bookmark = crowi.model('Bookmark')
    , ApiResponse = require('../util/apiResponse')

    , sprintf = require('sprintf')

    , actions = {};

  function getPathFromRequest(req) {
    var path = '/' + (req.params[0] || '');
    return path.replace(/\.md$/, '');
  }

  function isUserPage(path) {
    if (path.match(/^\/user\/[^\/]+\/?$/)) {
      return true;
    }

    return false;
  }

  // TODO: total とかでちゃんと計算する
  function generatePager(options) {
    var next = null,
      prev = null,
      offset = parseInt(options.offset, 10),
      limit  = parseInt(options.limit, 10),
      length = options.length || 0;


    if (offset > 0) {
      prev = offset - limit;
      if (prev < 0) {
        prev = 0;
      }
    }

    if (length < limit) {
      next = null;
    } else {
      next = offset + limit;
    }

    return {
      prev: prev,
      next: next,
      offset: offset,
    };
  }

  // routing
  actions.pageListShow = function(req, res) {
    var path = getPathFromRequest(req);
    var limit = 50;
    var offset = parseInt(req.query.offset)  || 0;
    path = path + (path == '/' ? '' : '/');

    // index page
    var pagerOptions = {
      offset: offset,
      limit : limit
    };
    var queryOptions = {
      offset: offset,
      limit : limit + 1
    };

    var renderVars = {
      page: null,
      path: path,
      pages: [],
    };

    Page.hasPortalPage(path, req.user)
    .then(function(portalPage) {
      renderVars.page = portalPage;

      return Page.findListByStartWith(path, req.user, queryOptions);
    }).then(function(pageList) {

      if (pageList.length > limit) {
        pageList.pop();
      }

      pagerOptions.length = pageList.length;

      renderVars.pager = generatePager(pagerOptions);
      renderVars.pages = pageList;
      res.render('page_list', renderVars);
    }).catch(function(err) {
      debug('Error on rendering pageListShow', err);
    });
  };

  actions.search = function(req, res) {
    // spec: ?q=query&sort=sort_order&author=author_filter
    var query = req.query.q;
    var search = require('../util/search')(crowi);

    search.searchPageByKeyword(query)
    .then(function(pages) {
      debug('pages', pages);

      if (pages.hits.total <= 0) {
        return Promise.resolve([]);
      }

      var ids = pages.hits.hits.map(function(page) {
        return page._id;
      });

      return Page.findListByPageIds(ids);
    }).then(function(pages) {

      res.render('page_list', {
        path: '/',
        pages: pages,
        pager: generatePager({offset: 0, limit: 50})
      });
    }).catch(function(err) {
      debug('search error', err);
    });
  };

  actions.search = function(req, res) {
    // spec: ?q=query&sort=sort_order&author=author_filter
    var query = req.query.q;
    var search = require('../util/search')(crowi);

    search.searchPageByKeyword(query)
    .then(function(pages) {
      debug('pages', pages);

      if (pages.hits.total <= 0) {
        return Promise.resolve([]);
      }

      var ids = pages.hits.hits.map(function(page) {
        return page._id;
      });

      return Page.findListByPageIds(ids);
    }).then(function(pages) {

      res.render('page_list', {
        path: '/',
        pages: pages,
        pager: generatePager({offset: 0, limit: 50})
      });
    }).catch(function(err) {
      debug('search error', err);
    });
  };

  function renderPage(pageData, req, res) {
    // create page
    if (!pageData) {
      return res.render('page', {
        author: {},
        page: false,
      });
    }

    if (pageData.redirectTo) {
      return res.redirect(encodeURI(pageData.redirectTo + '?renamed=' + pageData.path));
    }

    var renderVars = {
      path: pageData.path,
      page: pageData,
      revision: pageData.revision || {},
      author: pageData.revision.author || false,
    };
    var userPage = isUserPage(pageData.path);
    var userData = null;
    // plugin test
    var pluginNameStart = renderVars.page.revision.body.indexOf("```#") + 4;
    console.log(pluginNameStart);
    var pluginNameEnd = renderVars.page.revision.body.slice(pluginNameStart).indexOf("\r") + pluginNameStart;
    renderVars.pluginName = renderVars.page.revision.body.slice(pluginNameStart, pluginNameEnd) + ".js";
    // plugin test

    Revision.findRevisionList(pageData.path, {})
    .then(function(tree) {
      renderVars.tree = tree;

      return Promise.resolve();
    }).then(function() {
      if (userPage) {
        return User.findUserByUsername(User.getUsernameByPath(pageData.path))
        .then(function(data) {
          if (data === null) {
            throw new Error('The user not found.');
          }
          userData = data;
          renderVars.pageUser = userData;

          return Bookmark.findByUser(userData, {limit: 10, populatePage: true, requestUser: req.user});
        }).then(function(bookmarkList) {
          renderVars.bookmarkList = bookmarkList;

          return Page.findListByCreator(userData, {limit: 10});
        }).then(function(createdList) {
          renderVars.createdList = createdList;
          return Promise.resolve();
        }).catch(function(err) {
          debug('Error on finding user related entities', err);
          // pass
        });
      } else {
        return Promise.resolve();
      }
    }).then(function() {
      var defaultPageTeamplate = 'page';
      if (userData) {
        defaultPageTeamplate = 'user_page';
      }

      res.render(req.query.presentation ? 'page_presentation' : defaultPageTeamplate, renderVars);
    }).catch(function(err) {
      debug('Error: renderPage()', err);
      if (err) {
        res.redirect('/');
      }
    });
  }

  actions.pageShow = function(req, res) {
    var path = path || getPathFromRequest(req);
    var options = {};

    // FIXME: せっかく getPathFromRequest になってるのにここが生 params[0] だとダサイ
    var isMarkdown = req.params[0].match(/.+\.md$/) || false;

    res.locals.path = path;

    // pageShow は /* にマッチしてる最後の砦なので、creatableName でない routing は
    // これ以前に定義されているはずなので、こうしてしまって問題ない。
    if (!Page.isCreatableName(path)) {
      debug('Page is not creatable name.', path);
      res.redirect('/');
      return ;
    }

    Page.findPage(path, req.user, req.query.revision)
    .then(function(page) {
      debug('Page found', page._id, page.path);

      if (isMarkdown) {
        res.set('Content-Type', 'text/plain');
        return res.send(page.revision.body);
      }

      return renderPage(page, req, res);
    }).catch(function(err) {
      if (req.query.revision) {
        return res.redirect(encodeURI(path));
      }

      if (isMarkdown) {
        return res.redirect('/');
      }

      Page.hasPortalPage(path + '/', req.user)
      .then(function(page) {
        if (page) {
          return res.redirect(encodeURI(path) + '/');
        } else {
          debug('Catch pageShow', err);
          return renderPage(null, req, res);
        }
      }).catch(function(err) {
        debug('Error on rendering pageShow (redirect to portal)', err);
      });
    });
  };

  actions.pageEdit = function(req, res) {

    var pageForm = req.body.pageForm;
    var body = pageForm.body;
    var currentRevision = pageForm.currentRevision;
    var grant = pageForm.grant;
    var path = pageForm.path;

    // TODO: make it pluggable
    var notify = pageForm.notify || {};

    debug('notify: ', notify);

    var redirectPath = encodeURI(path);
    var pageData = {};
    var updateOrCreate;
    var previousRevision = false;

    // set to render
    res.locals.pageForm = pageForm;

    if (!Page.isCreatableName(path)) {
      res.redirect(redirectPath);
      return ;
    }

    var ignoreNotFound = true;
    Page.findPage(path, req.user, null, ignoreNotFound)
    .then(function(data) {
      pageData = data;

      if (!req.form.isValid) {
        debug('Form data not valid');
        throw new Error('Form data not valid.');
      }

      if (data && !data.isUpdatable(currentRevision)) {
        debug('Conflict occured');
        req.form.errors.push('すでに他の人がこのページを編集していたため保存できませんでした。ページを再読み込み後、自分の編集箇所のみ再度編集してください。');
        throw new Error('Conflict.');
      }

      if (data) {
        previousRevision = data.revision;
        return Page.updatePage(data, body, req.user, {grant: grant});
      } else {
        // new page
        updateOrCreate = 'create';
        return Page.create(path, body, req.user, {grant: grant});
      }
    }).then(function(data) {
      // data is a saved page data.
      pageData = data;
      if (!data) {
        throw new Error('Data not found');
      }
      // TODO: move to events
      crowi.getIo().sockets.emit('page edited', {page: data, user: req.user});
      if (notify.slack) {
        if (notify.slack.on && notify.slack.channel) {
          data.updateSlackChannel(notify.slack.channel).then(function(){}).catch(function(){});

          if (crowi.slack) {
            notify.slack.channel.split(',').map(function(chan) {
              var message = crowi.slack.prepareSlackMessage(pageData, req.user, chan, updateOrCreate, previousRevision);
              crowi.slack.post(message).then(function(){}).catch(function(){});
            });
          }
        }
      }

      return res.redirect(redirectPath);
    }).catch(function(err) {
      debug('Page create or edit error.', err);
      if (pageData && !req.form.isValid) {
        return renderPage(pageData, req, res);
      }

      return res.redirect(redirectPath);
    });
  };

  // app.get( '/users/:username([^/]+)/bookmarks'      , loginRequired(crowi, app) , page.userBookmarkList);
  actions.userBookmarkList = function(req, res) {
    var username = req.params.username;
    var limit = 50;
    var offset = parseInt(req.query.offset)  || 0;

    var user;
    var renderVars = {};

    var pagerOptions = { offset: offset, limit : limit };
    var queryOptions = { offset: offset, limit : limit + 1, populatePage: true, requestUser: req.user};

    User.findUserByUsername(username)
    .then(function(user) {
      if (user === null) {
        throw new Error('The user not found.');
      }
      renderVars.user = user;

      return Bookmark.findByUser(user, queryOptions);
    }).then(function(bookmarks) {

      if (bookmarks.length > limit) {
        bookmarks.pop();
      }
      pagerOptions.length = bookmarks.length;

      renderVars.pager = generatePager(pagerOptions);
      renderVars.bookmarks = bookmarks;

      return res.render('user/bookmarks', renderVars);
    }).catch(function(err) {
      debug('Error on rendereing bookmark', err);
      res.redirect('/');
    });
  };

  // app.get( '/users/:username([^/]+)/recent-create' , loginRequired(crowi, app) , page.userRecentCreatedList);
  actions.userRecentCreatedList = function(req, res) {
    var username = req.params.username;
    var limit = 50;
    var offset = parseInt(req.query.offset) || 0;

    var user;
    var renderVars = {};

    var pagerOptions = { offset: offset, limit : limit };
    var queryOptions = { offset: offset, limit : limit + 1};


    User.findUserByUsername(username)
    .then(function(user) {
      if (user === null) {
        throw new Error('The user not found.');
      }
      renderVars.user = user;

      return Page.findListByCreator(user, queryOptions);
    }).then(function(pages) {

      if (pages.length > limit) {
        pages.pop();
      }
      pagerOptions.length = pages.length;

      renderVars.pager = generatePager(pagerOptions);
      renderVars.pages = pages;

      return res.render('user/recent-create', renderVars);
    }).catch(function(err) {
      debug('Error on rendereing recent-created', err);
      res.redirect('/');
    });
  };

  var api = actions.api = {};

  /**
   * redirector
   */
  api.redirector = function(req, res){
    var id = req.params.id;

    Page.findPageById(id)
    .then(function(pageData) {

      if (pageData.grant == Page.GRANT_RESTRICTED && !pageData.isGrantedFor(req.user)) {
        return Page.pushToGrantedUsers(pageData, req.user);
      }

      return Promise.resolve(pageData);
    }).then(function(page) {

      return res.redirect(encodeURI(page.path));
    }).catch(function(err) {
      return res.redirect('/');
    });
  };

  /**
   * @api {get} /pages.get Get page data
   * @apiName GetPage
   * @apiGroup Page
   *
   * @apiParam {String} page_id
   * @apiParam {String} path
   * @apiParam {String} revision_id
   */
  api.get = function(req, res){
    var pagePath = req.query.path || null;
    var pageId = req.query.page_id || null; // TODO: handling
    var revisionId = req.query.revision_id || null;

    Page.findPage(pagePath, req.user, revisionId)
    .then(function(pageData) {
      var result = {};
      result.page = pageData;

      return res.json(ApiResponse.success(result));
    }).catch(function(err) {
      return res.json(ApiResponse.error(err));
    });
  };

  /**
   * @api {post} /pages.seen Mark as seen user
   * @apiName SeenPage
   * @apiGroup Page
   *
   * @apiParam {String} page_id Page Id.
   */
  api.seen = function(req, res){
    var pageId = req.body.page_id;
    if (!pageId) {
      return res.json(ApiResponse.error('page_id required'));
    }

    Page.findPageByIdAndGrantedUser(pageId, req.user)
    .then(function(page) {
      return page.seen(req.user);
    }).then(function(user) {
      var result = {};
      result.seenUser = user;

      return res.json(ApiResponse.success(result));
    }).catch(function(err) {
      debug('Seen user update error', err);
      return res.json(ApiResponse.error(err));
    });
  };

  /**
   * @api {post} /likes.add Like page
   * @apiName LikePage
   * @apiGroup Page
   *
   * @apiParam {String} page_id Page Id.
   */
  api.like = function(req, res){
    var id = req.body.page_id;

    Page.findPageByIdAndGrantedUser(id, req.user)
    .then(function(pageData) {
      return pageData.like(req.user);
    }).then(function(data) {
      var result = {page: data};
      return res.json(ApiResponse.success(result));
    }).catch(function(err) {
      debug('Like failed', err);
      return res.json(ApiResponse.error({}));
    });
  };

  /**
   * @api {post} /likes.remove Unlike page
   * @apiName UnlikePage
   * @apiGroup Page
   *
   * @apiParam {String} page_id Page Id.
   */
  api.unlike = function(req, res){
    var id = req.body.page_id;

    Page.findPageByIdAndGrantedUser(id, req.user)
    .then(function(pageData) {
      return pageData.unlike(req.user);
    }).then(function(data) {
      var result = {page: data};
      return res.json(ApiResponse.success(result));
    }).catch(function(err) {
      debug('Unlike failed', err);
      return res.json(ApiResponse.error({}));
    });
  };

  /**
   * @api {get} /pages.updatePost
   * @apiName Get UpdatePost setting list
   * @apiGroup Page
   *
   * @apiParam {String} path
   */
  api.getUpdatePost = function(req, res) {
    var path = req.query.path;
    var UpdatePost = crowi.model('UpdatePost');

    if (!path) {
      return res.json(ApiResponse.error({}));
    }

    UpdatePost.findSettingsByPath(path)
    .then(function(data) {
      data = data.map(function(e) {
        return e.channel;
      });
      debug('Found updatePost data', data);
      var result = {updatePost: data};
      return res.json(ApiResponse.success(result));
    }).catch(function(err) {
      debug('Error occured while get setting', err);
      return res.json(ApiResponse.error({}));
    });
  };

  /**
   * @api {post} /pages.rename Rename page
   * @apiName SeenPage
   * @apiGroup Page
   *
   * @apiParam {String} page_id Page Id.
   * @apiParam {String} path
   * @apiParam {String} revision_id
   * @apiParam {String} new_path
   * @apiParam {Bool} create_redirect
   */
  api.rename = function(req, res){
    var pageId = req.body.page_id;
    var previousRevision = req.body.revision_id || null;
    var newPagePath = Page.normalizePath(req.body.new_path);
    var options = {
      createRedirectPage: req.body.create_redirect || 0,
      moveUnderTrees: req.body.move_trees || 0,
    };
    var page = {};

    if (!Page.isCreatableName(newPagePath)) {
      return res.json(ApiResponse.error(sprintf('このページ名は作成できません (%s)', newPagePath)));
    }

    Page.findPageByPath(newPagePath)
    .then(function(page) {
      // if page found, cannot cannot rename to that path
      return res.json(ApiResponse.error(sprintf('このページ名は作成できません (%s)。ページが存在します。', newPagePath)));
    }).catch(function(err) {

      Page.findPageById(pageId)
      .then(function(pageData) {
        page = pageData;
        if (!pageData.isUpdatable(previousRevision)) {
          return res.json(ApiResponse.error('誰かが更新している可能性があります。ページを更新できません。'));
        }

        return Page.rename(pageData, newPagePath, req.user, options);
      }).then(function() {
        var result = {};
        result.page = page;

        return res.json(ApiResponse.success(result));
      }).catch(function(err) {
        return res.json(ApiResponse.error('エラーが発生しました。ページを更新できません。'));
      });
    });
  };

  return actions;
};
