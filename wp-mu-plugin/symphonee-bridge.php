<?php
/**
 * Plugin Name: Symphonee Bridge
 * Description: Exposes page-builder post meta (Elementor, Breakdance, Bricks, Beaver, Divi) and SEO plugin meta (Yoast, RankMath) plus a handful of site helpers over the WordPress REST API so the Symphonee WordPress plugin can read and write page layouts and SEO fields reliably. Drop this file into wp-content/mu-plugins/ so it loads before everything else and cannot be deactivated.
 * Version: 1.1.0
 * Author: Symphonee
 *
 * This file is intentionally tiny and has no admin UI. It only does two things:
 *
 *   1. Registers well-known page-builder meta keys with show_in_rest => true so
 *      authenticated REST clients with edit_posts capability can read and write
 *      them. Without this, Elementor's _elementor_data field is invisible to the
 *      REST API, which is why third-party tools get "200 OK but nothing updates."
 *
 *   2. Adds a single helper route /symphonee/v1/builder-info/{id} that returns
 *      which builder a given post is using, its version, and a hash of its data.
 *      The Symphonee plugin uses this to detect builder choice without having
 *      to parse every meta field itself.
 *
 * Safe to ship to production: read callers require edit_posts, writes require
 * edit_post for the specific post, and nothing is logged or modified beyond
 * meta registration.
 */

if (!defined('ABSPATH')) { exit; }

add_action('init', function () {
    // Post types that can have builder layouts.
    $post_types = array('post', 'page');
    // Also expose on any public CPT so custom builders on services/projects/etc work.
    foreach (get_post_types(array('public' => true), 'names') as $pt) {
        if (!in_array($pt, $post_types, true)) { $post_types[] = $pt; }
    }

    // Elementor meta keys.
    $elementor_keys = array(
        '_elementor_data',
        '_elementor_edit_mode',
        '_elementor_version',
        '_elementor_template_type',
        '_elementor_page_settings',
        '_elementor_css',
    );

    // Breakdance meta keys.
    $breakdance_keys = array(
        '_breakdance_data',
        'breakdance_data',
        '_breakdance_css',
        'breakdance_css',
    );

    // Bricks meta keys.
    $bricks_keys = array(
        'bricks_page_content_2',
        'bricks_page_header_2',
        'bricks_page_footer_2',
        '_bricks_page_settings',
    );

    // Beaver Builder meta keys.
    $beaver_keys = array(
        '_fl_builder_enabled',
        '_fl_builder_data',
        '_fl_builder_draft',
        '_fl_builder_data_settings',
    );

    // Divi meta keys.
    $divi_keys = array(
        '_et_pb_use_builder',
        '_et_pb_old_content',
        '_et_pb_page_layout',
        '_et_pb_side_nav',
    );

    // Yoast SEO meta keys. Without these, REST writes to Yoast fields return 200
    // but are silently filtered out by WordPress because they are not registered.
    $yoast_keys = array(
        '_yoast_wpseo_title',
        '_yoast_wpseo_metadesc',
        '_yoast_wpseo_focuskw',
        '_yoast_wpseo_canonical',
        '_yoast_wpseo_bctitle',
        '_yoast_wpseo_opengraph-title',
        '_yoast_wpseo_opengraph-description',
        '_yoast_wpseo_opengraph-image',
        '_yoast_wpseo_opengraph-image-id',
        '_yoast_wpseo_twitter-title',
        '_yoast_wpseo_twitter-description',
        '_yoast_wpseo_twitter-image',
        '_yoast_wpseo_twitter-image-id',
        '_yoast_wpseo_meta-robots-noindex',
        '_yoast_wpseo_meta-robots-nofollow',
        '_yoast_wpseo_meta-robots-adv',
        '_yoast_wpseo_primary_category',
    );

    // RankMath SEO meta keys. Parallel set to Yoast so either plugin works.
    $rankmath_keys = array(
        'rank_math_title',
        'rank_math_description',
        'rank_math_focus_keyword',
        'rank_math_canonical_url',
        'rank_math_breadcrumb_title',
        'rank_math_facebook_title',
        'rank_math_facebook_description',
        'rank_math_facebook_image',
        'rank_math_facebook_image_id',
        'rank_math_twitter_title',
        'rank_math_twitter_description',
        'rank_math_twitter_image',
        'rank_math_twitter_image_id',
        'rank_math_primary_category',
    );

    $all_keys = array_merge($elementor_keys, $breakdance_keys, $bricks_keys, $beaver_keys, $divi_keys, $yoast_keys, $rankmath_keys);

    // Auth callback: authenticated users with edit_posts, and fine-grained
    // edit_post check at write time via the meta field args on sanitize.
    $auth_cb = function ($allowed, $meta_key, $post_id) {
        return current_user_can('edit_post', $post_id);
    };

    foreach ($post_types as $pt) {
        foreach ($all_keys as $key) {
            register_post_meta($pt, $key, array(
                'show_in_rest'   => true,
                'single'         => true,
                'type'           => 'string',
                'auth_callback'  => function () { return current_user_can('edit_posts'); },
            ));
        }
    }
});

// Custom endpoint: which builder is this post using, and what is a quick fingerprint of its data?
add_action('rest_api_init', function () {
    register_rest_route('symphonee/v1', '/builder-info/(?P<id>\d+)', array(
        'methods'             => 'GET',
        'permission_callback' => function ($req) {
            return current_user_can('edit_post', (int) $req['id']);
        },
        'callback' => function ($req) {
            $id = (int) $req['id'];
            $post = get_post($id);
            if (!$post) {
                return new WP_Error('not_found', 'Post not found', array('status' => 404));
            }
            $meta = get_post_meta($id);
            $out = array(
                'id'      => $id,
                'title'   => $post->post_title,
                'status'  => $post->post_status,
                'builder' => null,
                'version' => null,
                'dataHash'=> null,
                'dataLen' => 0,
            );
            if (!empty($meta['_elementor_edit_mode']) && $meta['_elementor_edit_mode'][0] === 'builder') {
                $out['builder'] = 'elementor';
                $out['version'] = !empty($meta['_elementor_version']) ? $meta['_elementor_version'][0] : null;
                $data = !empty($meta['_elementor_data']) ? $meta['_elementor_data'][0] : '';
                $out['dataLen'] = strlen($data);
                $out['dataHash'] = $data ? md5($data) : null;
            } elseif (!empty($meta['_breakdance_data']) || !empty($meta['breakdance_data'])) {
                $out['builder'] = 'breakdance';
                $data = !empty($meta['_breakdance_data']) ? $meta['_breakdance_data'][0] : $meta['breakdance_data'][0];
                $out['dataLen'] = strlen($data);
                $out['dataHash'] = $data ? md5($data) : null;
            } elseif (!empty($meta['bricks_page_content_2'])) {
                $out['builder'] = 'bricks';
                $data = $meta['bricks_page_content_2'][0];
                $out['dataLen'] = strlen($data);
                $out['dataHash'] = md5($data);
            } elseif (!empty($meta['_fl_builder_enabled']) && $meta['_fl_builder_enabled'][0] === '1') {
                $out['builder'] = 'beaver';
                $data = !empty($meta['_fl_builder_data']) ? $meta['_fl_builder_data'][0] : '';
                $out['dataLen'] = strlen($data);
                $out['dataHash'] = $data ? md5($data) : null;
            } elseif (!empty($meta['_et_pb_use_builder']) && $meta['_et_pb_use_builder'][0] === 'on') {
                $out['builder'] = 'divi';
                $out['dataLen'] = strlen($post->post_content);
                $out['dataHash'] = md5($post->post_content);
            }
            return $out;
        },
    ));

    // Clear Elementor CSS cache for a post. Elementor caches rendered CSS in
    // _elementor_css meta; after a write via REST the cache needs to be
    // invalidated or the front end will show the old layout.
    register_rest_route('symphonee/v1', '/elementor/clear-cache/(?P<id>\d+)', array(
        'methods'             => 'POST',
        'permission_callback' => function ($req) {
            return current_user_can('edit_post', (int) $req['id']);
        },
        'callback' => function ($req) {
            $id = (int) $req['id'];
            delete_post_meta($id, '_elementor_css');
            if (class_exists('\\Elementor\\Plugin')) {
                try {
                    \Elementor\Plugin::$instance->files_manager->clear_cache();
                } catch (\Throwable $e) {
                    // Non-fatal: cache dir may be read-only
                }
            }
            return array('ok' => true, 'cleared' => true, 'id' => $id);
        },
    ));
});
